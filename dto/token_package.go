package dto

// TokenPackageModelSpec defines a model included in a package version and its
// multiplier relative to the platform reference price.
type TokenPackageModelSpec struct {
	Model      string  `json:"model"`
	Multiplier float64 `json:"multiplier"`
}

// TokenPackageSKU defines a purchasable quota-based SKU of a token package.
type TokenPackageSKU struct {
	SKUKey      string `json:"sku_key"`
	Title       string `json:"title"`
	PriceQuota  int64  `json:"price_quota"`
	CreditQuota int64  `json:"credit_quota"`
	ValidDays   int    `json:"valid_days"`
}

// TokenPackageChannelBinding defines a channel bound to a package version.
type TokenPackageChannelBinding struct {
	ChannelID int      `json:"channel_id"`
	Models    []string `json:"models"`
	Priority  int64    `json:"priority"`
	Weight    uint     `json:"weight"`
}

// TokenPackageChannelTestItem captures the auto-check probe result for a
// single (channel, model) pair.
type TokenPackageChannelTestItem struct {
	ChannelID     int    `json:"channel_id"`
	ChannelName   string `json:"channel_name,omitempty"`
	Model         string `json:"model"`
	Success       bool   `json:"success"`
	ReturnedModel string `json:"returned_model,omitempty"`
	ModelMismatch bool   `json:"model_mismatch,omitempty"`
	LatencyMs     int64  `json:"latency_ms"`
	Error         string `json:"error,omitempty"`
}

// TokenPackageTestReport holds the full auto-check report for a package version.
type TokenPackageTestReport struct {
	CheckedAt   int64                         `json:"checked_at"`
	Passed      bool                          `json:"passed"`
	Results     []TokenPackageChannelTestItem `json:"results"`
	FailReasons []string                      `json:"fail_reasons,omitempty"`
}

// CreateTokenPackageRequest is the seller payload to create a token package.
type CreateTokenPackageRequest struct {
	BillingMode string `json:"billing_mode"`
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	Description string `json:"description"`
}

// UpdateTokenPackageRequest is the seller payload to update package metadata.
type UpdateTokenPackageRequest struct {
	Title       string `json:"title"`
	Subtitle    string `json:"subtitle"`
	Description string `json:"description"`
}

// CreateTokenPackageVersionRequest submits a new version for auto-check/review.
type CreateTokenPackageVersionRequest struct {
	Models   []TokenPackageModelSpec      `json:"models"`
	SKUs     []TokenPackageSKU            `json:"skus"`
	Channels []TokenPackageChannelBinding `json:"channels"`
}

// ReviewTokenPackageVersionRequest is the admin payload to approve or reject a version.
type ReviewTokenPackageVersionRequest struct {
	ReviewNote string `json:"review_note"`
}

// TokenPackageVersionResponse exposes a package version to sellers/admins/marketplace.
type TokenPackageVersionResponse struct {
	ID          int                          `json:"id"`
	PackageID   int                          `json:"package_id"`
	VersionNo   int                          `json:"version_no"`
	Status      string                       `json:"status"`
	Models      []TokenPackageModelSpec      `json:"models"`
	SKUs        []TokenPackageSKU            `json:"skus"`
	Channels    []TokenPackageChannelBinding `json:"channels,omitempty"`
	TestReport  *TokenPackageTestReport      `json:"test_report,omitempty"`
	SubmittedAt int64                        `json:"submitted_at"`
	ReviewedBy  int                          `json:"reviewed_by,omitempty"`
	ReviewedAt  int64                        `json:"reviewed_at,omitempty"`
	ReviewNote  string                       `json:"review_note,omitempty"`
	CreatedAt   int64                        `json:"created_at"`
}

// TokenPackageResponse is the summary/detail view of a token package.
type TokenPackageResponse struct {
	ID              int                          `json:"id"`
	SellerUserID    int                          `json:"seller_user_id"`
	SellerName      string                       `json:"seller_name,omitempty"`
	BillingMode     string                       `json:"billing_mode"`
	Title           string                       `json:"title"`
	Subtitle        string                       `json:"subtitle"`
	Description     string                       `json:"description"`
	Status          string                       `json:"status"`
	ActiveVersionID int                          `json:"active_version_id"`
	Degraded        bool                         `json:"degraded"`
	ActiveVersion   *TokenPackageVersionResponse `json:"active_version,omitempty"`
	LatestVersion   *TokenPackageVersionResponse `json:"latest_version,omitempty"`
	CreatedAt       int64                        `json:"created_at"`
	UpdatedAt       int64                        `json:"updated_at"`
}

// TokenPackageReviewResponse is one entry of the admin review queue.
type TokenPackageReviewResponse struct {
	Version      *TokenPackageVersionResponse `json:"version"`
	Package      *TokenPackageResponse        `json:"package"`
	SellerUserID int                          `json:"seller_user_id"`
	SellerName   string                       `json:"seller_name,omitempty"`
}

// PurchaseTokenPackageRequest buys a specific SKU from a listed package using wallet balance.
type PurchaseTokenPackageRequest struct {
	SKUKey string `json:"sku_key"`
}

// TokenPackageOrderResponse describes a buyer's package purchase order.
type TokenPackageOrderResponse struct {
	ID              int              `json:"id"`
	TradeNo         string           `json:"trade_no"`
	BuyerUserID     int              `json:"buyer_user_id"`
	PackageID       int              `json:"package_id"`
	PackageTitle    string           `json:"package_title,omitempty"`
	VersionID       int              `json:"version_id"`
	SKUSnapshot     *TokenPackageSKU `json:"sku_snapshot,omitempty"`
	PriceQuota      int64            `json:"price_quota"`
	CommissionBps   int              `json:"commission_bps"`
	CommissionQuota int64            `json:"commission_quota"`
	SellerQuota     int64            `json:"seller_quota"`
	Status          string           `json:"status"`
	RefundedQuota   int64            `json:"refunded_quota"`
	CreatedAt       int64            `json:"created_at"`
}

// TokenPackageEntitlementResponse describes a buyer's purchased package entitlement.
type TokenPackageEntitlementResponse struct {
	ID              int                     `json:"id"`
	UserID          int                     `json:"user_id"`
	PackageID       int                     `json:"package_id"`
	PackageTitle    string                  `json:"package_title,omitempty"`
	PackageStatus   string                  `json:"package_status,omitempty"`
	VersionID       int                     `json:"version_id"`
	OrderID         int                     `json:"order_id"`
	BillingMode     string                  `json:"billing_mode"`
	ModelsSnapshot  []TokenPackageModelSpec `json:"models_snapshot"`
	AmountTotal     int64                   `json:"amount_total"`
	AmountUsed      int64                   `json:"amount_used"`
	AmountRemaining int64                   `json:"amount_remaining"`
	PaidQuota       int64                   `json:"paid_quota"`
	StartTime       int64                   `json:"start_time"`
	EndTime         int64                   `json:"end_time"`
	ExtendedSeconds int64                   `json:"extended_seconds"`
	Status          string                  `json:"status"`
	RefundedQuota   int64                   `json:"refunded_quota,omitempty"`
	CreatedAt       int64                   `json:"created_at"`
}

// TokenPackageOutageResponse describes an outage/extension record on a package.
type TokenPackageOutageResponse struct {
	ID              int    `json:"id"`
	PackageID       int    `json:"package_id"`
	StartedAt       int64  `json:"started_at"`
	EndedAt         int64  `json:"ended_at"`
	DurationSeconds int64  `json:"duration_seconds"`
	Compensated     bool   `json:"compensated"`
	Detail          string `json:"detail"`
}

// SubmitVerificationRequest carries real-name verification input (plaintext ID
// number is only processed in memory and never persisted or logged).
type SubmitVerificationRequest struct {
	RealName       string `json:"real_name"`
	IDNumber       string `json:"id_number"`
	Consent        bool   `json:"consent"`
	ConsentVersion string `json:"consent_version"`
}

// VerificationStatusResponse returns minimized real-name verification state.
type VerificationStatusResponse struct {
	Status          string `json:"status"`
	Provider        string `json:"provider,omitempty"`
	ProviderTraceID string `json:"provider_trace_id,omitempty"`
	MaskedName      string `json:"masked_name,omitempty"`
	ReviewNote      string `json:"review_note,omitempty"`
	VerifiedAt      int64  `json:"verified_at,omitempty"`
	UpdatedAt       int64  `json:"updated_at,omitempty"`
}

// SellerStatusResponse summarizes a user's current seller eligibility.
type SellerStatusResponse struct {
	Eligible           bool     `json:"eligible"`
	Verified           bool     `json:"verified"`
	InSellerGroup      bool     `json:"in_seller_group"`
	PublishBanned      bool     `json:"publish_banned"`
	BanReason          string   `json:"ban_reason,omitempty"`
	Reasons            []string `json:"reasons,omitempty"`
	VerificationStatus string   `json:"verification_status"`
}

// SellerProfileResponse exposes seller account balances and status.
type SellerProfileResponse struct {
	UserID                int    `json:"user_id"`
	Username              string `json:"username,omitempty"`
	PublishBanned         bool   `json:"publish_banned"`
	BanReason             string `json:"ban_reason,omitempty"`
	CommissionBpsOverride *int   `json:"commission_bps_override,omitempty"`
	EffectiveCommission   int    `json:"effective_commission_bps"`
	PendingQuota          int64  `json:"pending_quota"`
	FrozenQuota           int64  `json:"frozen_quota"`
	SettledTotalQuota     int64  `json:"settled_total_quota"`
	Eligible              bool   `json:"eligible"`
	VerificationStatus    string `json:"verification_status,omitempty"`
	MaskedName            string `json:"masked_name,omitempty"`
}

// SellerLedgerEntryResponse describes a single seller ledger entry.
type SellerLedgerEntryResponse struct {
	ID            int    `json:"id"`
	SellerUserID  int    `json:"seller_user_id"`
	EntitlementID int    `json:"entitlement_id"`
	OrderID       int    `json:"order_id"`
	Type          string `json:"type"`
	Amount        int64  `json:"amount"`
	AvailableAt   int64  `json:"available_at"`
	Status        string `json:"status"`
	CreatedAt     int64  `json:"created_at"`
}

// AdminUpdateSellerRequest updates seller publish restrictions or commission overrides.
type AdminUpdateSellerRequest struct {
	PublishBanned         *bool  `json:"publish_banned"`
	BanReason             string `json:"ban_reason"`
	CommissionBpsOverride *int   `json:"commission_bps_override"`
	ClearCommission       bool   `json:"clear_commission"`
}

// AdminVerificationResponse is the masked administrator view of a real-name
// submission. It never carries the ID number or its hash.
type AdminVerificationResponse struct {
	UserID          int    `json:"user_id"`
	Username        string `json:"username"`
	Status          string `json:"status"`
	Provider        string `json:"provider"`
	ProviderTraceID string `json:"provider_trace_id"`
	MaskedName      string `json:"masked_name"`
	ReviewNote      string `json:"review_note"`
	ReviewedBy      int    `json:"reviewed_by"`
	ConsentAt       int64  `json:"consent_at"`
	ConsentVersion  string `json:"consent_version"`
	VerifiedAt      int64  `json:"verified_at"`
	CreatedAt       int64  `json:"created_at"`
	UpdatedAt       int64  `json:"updated_at"`
	// SellerGroup is true when the user is in a group that may publish, so a
	// reviewer can tell seller applications from buyers verifying to purchase.
	SellerGroup bool `json:"seller_group"`
}

// ReviewVerificationRequest carries an administrator decision on one pending
// real-name submission.
type ReviewVerificationRequest struct {
	Approved   bool   `json:"approved"`
	ReviewNote string `json:"review_note"`
}
