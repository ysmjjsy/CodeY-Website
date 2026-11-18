package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"

	"gorm.io/gorm"
)

// SellerLedgerEntry is the append-only seller revenue ledger. Pending quota is
// only released through these entries, so a refund can always be traced back to
// the sale it came from.
type SellerLedgerEntry struct {
	Id            int    `json:"id"`
	SellerUserId  int    `json:"seller_user_id" gorm:"index;not null"`
	EntitlementId int    `json:"entitlement_id" gorm:"index;default:0"`
	OrderId       int    `json:"order_id" gorm:"index;default:0"`
	Type          string `json:"type" gorm:"type:varchar(32);index"`
	Amount        int64  `json:"amount" gorm:"bigint;not null;default:0"`
	AvailableAt   int64  `json:"available_at" gorm:"index;default:0"`
	Status        string `json:"status" gorm:"type:varchar(32);index"`
	CreatedAt     int64  `json:"created_at"`
	UpdatedAt     int64  `json:"updated_at"`
}

func (entry *SellerLedgerEntry) TableName() string {
	return "seller_ledger_entries"
}

// TokenPackageOrder records one sale. Commission and seller share are frozen at
// sale time so a later commission change never rewrites past orders.
type TokenPackageOrder struct {
	Id              int    `json:"id"`
	TradeNo         string `json:"trade_no" gorm:"uniqueIndex;type:varchar(64);not null"`
	BuyerUserId     int    `json:"buyer_user_id" gorm:"index;not null"`
	PackageId       int    `json:"package_id" gorm:"index;not null"`
	VersionId       int    `json:"version_id" gorm:"index;not null"`
	SkuSnapshot     string `json:"-" gorm:"type:text"`
	PriceQuota      int64  `json:"price_quota" gorm:"bigint;not null;default:0"`
	CommissionBps   int    `json:"commission_bps" gorm:"not null;default:0"`
	CommissionQuota int64  `json:"commission_quota" gorm:"bigint;not null;default:0"`
	SellerQuota     int64  `json:"seller_quota" gorm:"bigint;not null;default:0"`
	Status          string `json:"status" gorm:"type:varchar(32);index"`
	RefundedQuota   int64  `json:"refunded_quota" gorm:"bigint;not null;default:0"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
}

func (order *TokenPackageOrder) TableName() string {
	return "token_package_orders"
}

func (order *TokenPackageOrder) GetSKUSnapshot() (*dto.TokenPackageSKU, error) {
	if order.SkuSnapshot == "" {
		return nil, nil
	}
	var sku dto.TokenPackageSKU
	if err := common.UnmarshalJsonStr(order.SkuSnapshot, &sku); err != nil {
		return nil, err
	}
	return &sku, nil
}

var (
	ErrPackageNotOnSale         = errors.New("the token package is not on sale")
	ErrPackageSKUNotFound       = errors.New("the selected package SKU does not exist")
	ErrPackageSelfPurchase      = errors.New("a seller cannot buy their own token package")
	ErrPackageSameRealnameDeal  = errors.New("buyer and seller cannot be the same verified person")
	ErrPackageBuyerUnverified   = errors.New("the buyer has no verified real name")
	ErrPackageInsufficientFunds = errors.New("insufficient wallet balance for this token package")
)

// PackagePurchaseResult describes what a successful purchase created.
type PackagePurchaseResult struct {
	Order       *TokenPackageOrder
	Entitlement *TokenPackageEntitlement
}

func packageSKUByKey(skus []dto.TokenPackageSKU, skuKey string) (*dto.TokenPackageSKU, bool) {
	for i := range skus {
		if skus[i].SKUKey == skuKey {
			return &skus[i], true
		}
	}
	return nil, false
}

func verifiedIDHash(tx *gorm.DB, userId int) (string, error) {
	var verification UserVerification
	err := tx.Where("user_id = ? AND status = ?", userId, constant.UserVerificationStatusVerified).First(&verification).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return verification.IdNumberHash, nil
}

func commissionQuotaFor(priceQuota int64, bps int) int64 {
	if priceQuota <= 0 || bps <= 0 {
		return 0
	}
	if bps > 10000 {
		bps = 10000
	}
	return priceQuota * int64(bps) / 10000
}

// PurchaseTokenPackage debits the buyer's wallet and creates the order,
// entitlement and seller ledger entry in one transaction. verifySeller re-checks
// seller eligibility inside the transaction so a seller who loses eligibility
// between listing and purchase cannot collect revenue.
func PurchaseTokenPackage(userId, packageId int, skuKey string, commissionBps int, verifySeller func(tx *gorm.DB, sellerUserId int) error) (*PackagePurchaseResult, error) {
	if userId <= 0 || packageId <= 0 || skuKey == "" {
		return nil, ErrPackageSKUNotFound
	}
	var result PackagePurchaseResult
	packageTitle := ""
	err := DB.Transaction(func(tx *gorm.DB) error {
		var pkg TokenPackage
		if err := lockForUpdate(tx).Where("id = ?", packageId).First(&pkg).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTokenPackageNotFound
			}
			return err
		}
		if pkg.Status != constant.TokenPackageStatusListed || pkg.ActiveVersionId <= 0 {
			return ErrPackageNotOnSale
		}
		if pkg.SellerUserId == userId {
			return ErrPackageSelfPurchase
		}
		if verifySeller != nil {
			if err := verifySeller(tx, pkg.SellerUserId); err != nil {
				return err
			}
		}
		version, err := GetTokenPackageVersionTx(tx, pkg.ActiveVersionId)
		if err != nil {
			return err
		}
		if version.Status != constant.TokenPackageVersionStatusApproved {
			return ErrPackageNotOnSale
		}
		sku, ok := packageSKUByKey(version.GetSKUList(), skuKey)
		if !ok || sku.PriceQuota <= 0 || sku.CreditQuota <= 0 || sku.ValidDays <= 0 {
			return ErrPackageSKUNotFound
		}
		var buyer User
		if err := lockForUpdate(tx).Where("id = ?", userId).First(&buyer).Error; err != nil {
			return err
		}
		if int64(buyer.Quota) < sku.PriceQuota {
			return ErrPackageInsufficientFunds
		}
		buyerHash, err := verifiedIDHash(tx, userId)
		if err != nil {
			return err
		}
		// An unverified buyer has no identity to compare, so the same-person
		// check would never see a seller buying through a second account.
		if buyerHash == "" {
			return ErrPackageBuyerUnverified
		}
		sellerHash, err := verifiedIDHash(tx, pkg.SellerUserId)
		if err != nil {
			return err
		}
		if sellerHash != "" && buyerHash == sellerHash {
			return ErrPackageSameRealnameDeal
		}

		if err := tx.Model(&User{}).Where("id = ?", userId).
			Update("quota", gorm.Expr("quota - ?", sku.PriceQuota)).Error; err != nil {
			return err
		}

		now := common.GetTimestamp()
		commissionQuota := commissionQuotaFor(sku.PriceQuota, commissionBps)
		sellerQuota := sku.PriceQuota - commissionQuota
		order := &TokenPackageOrder{
			TradeNo:         fmt.Sprintf("TP%d%s%d", userId, common.GetRandomString(6), time.Now().UnixNano()),
			BuyerUserId:     userId,
			PackageId:       pkg.Id,
			VersionId:       version.Id,
			PriceQuota:      sku.PriceQuota,
			CommissionBps:   commissionBps,
			CommissionQuota: commissionQuota,
			SellerQuota:     sellerQuota,
			Status:          constant.TokenPackageOrderStatusPaid,
			CreatedAt:       now,
			UpdatedAt:       now,
		}
		skuSnapshot, err := common.Marshal(sku)
		if err != nil {
			return err
		}
		order.SkuSnapshot = string(skuSnapshot)
		if err := tx.Create(order).Error; err != nil {
			return err
		}

		entitlement := &TokenPackageEntitlement{
			UserId:           userId,
			PackageId:        pkg.Id,
			VersionId:        version.Id,
			OrderId:          order.Id,
			BillingMode:      constant.TokenPackageBillingModeQuota,
			AmountTotal:      sku.CreditQuota,
			PaidQuota:        sku.PriceQuota,
			SellerQuotaTotal: sellerQuota,
			CommissionQuota:  commissionQuota,
			StartTime:        now,
			EndTime:          now + int64(sku.ValidDays)*86400,
			Status:           constant.TokenPackageEntitlementStatusActive,
			CreatedAt:        now,
			UpdatedAt:        now,
		}
		if err := entitlement.SetModelSpecs(version.GetModelSpecs()); err != nil {
			return err
		}
		if err := tx.Create(entitlement).Error; err != nil {
			return err
		}

		profile, err := GetOrCreateSellerProfileWithTx(tx, pkg.SellerUserId)
		if err != nil {
			return err
		}
		if err := tx.Model(&SellerProfile{}).Where("id = ?", profile.Id).
			Update("pending_quota", gorm.Expr("pending_quota + ?", sellerQuota)).Error; err != nil {
			return err
		}
		entry := &SellerLedgerEntry{
			SellerUserId:  pkg.SellerUserId,
			EntitlementId: entitlement.Id,
			OrderId:       order.Id,
			Type:          constant.SellerLedgerTypeSalePending,
			Amount:        sellerQuota,
			Status:        constant.SellerLedgerStatusPending,
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if err := tx.Create(entry).Error; err != nil {
			return err
		}
		packageTitle = pkg.Title
		result.Order = order
		result.Entitlement = entitlement
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := cacheDecrUserQuota(userId, result.Order.PriceQuota); err != nil {
		common.SysLog(common.LogText("failed to decrease user quota cache after token package purchase: %s", err.Error()))
	}
	RecordLog(userId, LogTypeTopup, common.NewMessage("Token package purchased, package: {{package}}, price: {{price}}, quota: {{quota}}", map[string]any{
		"package": packageTitle,
		"price":   float64(result.Order.PriceQuota) / common.QuotaPerUnit,
		"quota":   result.Order.PriceQuota,
	}))
	return &result, nil
}

// GetTokenPackageOrder reads one order by id.
func GetTokenPackageOrder(id int) (*TokenPackageOrder, error) {
	var order TokenPackageOrder
	if err := DB.Where("id = ?", id).First(&order).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

// ListTokenPackageOrdersByUser returns a buyer's orders, newest first.
func ListTokenPackageOrdersByUser(userId, page, pageSize int) ([]TokenPackageOrder, int64, error) {
	var total int64
	if err := DB.Model(&TokenPackageOrder{}).Where("buyer_user_id = ?", userId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	orders := make([]TokenPackageOrder, 0)
	err := DB.Where("buyer_user_id = ?", userId).Order("id DESC").
		Limit(pageSize).Offset((page - 1) * pageSize).Find(&orders).Error
	return orders, total, err
}
