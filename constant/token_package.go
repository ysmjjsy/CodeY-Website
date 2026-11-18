package constant

import (
	"strconv"
	"strings"
)

const TokenPackageGroupPrefix = "pkg:"

// Token package statuses (§9.1)
const (
	TokenPackageStatusDraft      = "draft"
	TokenPackageStatusListed     = "listed"
	TokenPackageStatusPaused     = "paused"
	TokenPackageStatusStopped    = "stopped"
	TokenPackageStatusTerminated = "terminated"
)

// Token package version statuses (§9.1)
const (
	TokenPackageVersionStatusDraft         = "draft"
	TokenPackageVersionStatusTesting       = "testing"
	TokenPackageVersionStatusPendingReview = "pending_review"
	TokenPackageVersionStatusApproved      = "approved"
	TokenPackageVersionStatusRejected      = "rejected"
	TokenPackageVersionStatusSuperseded    = "superseded"
)

// Token package billing modes (§5.2)
const (
	TokenPackageBillingModeQuota = "quota"
)

// Token package order statuses (§5.5)
const (
	TokenPackageOrderStatusPaid     = "paid"
	TokenPackageOrderStatusRefunded = "refunded"
)

// Token package entitlement statuses (§5.6)
const (
	TokenPackageEntitlementStatusActive     = "active"
	TokenPackageEntitlementStatusExhausted  = "exhausted"
	TokenPackageEntitlementStatusExpired    = "expired"
	TokenPackageEntitlementStatusTerminated = "terminated"
)

// Token package pre-consume record statuses (§5.7)
const (
	TokenPackagePreConsumePending  = "pending"
	TokenPackagePreConsumeSettled  = "settled"
	TokenPackagePreConsumeRefunded = "refunded"
)

// Seller ledger entry types and statuses (§5.8)
const (
	SellerLedgerTypeSalePending = "sale_pending"
	SellerLedgerTypeRelease     = "release"
	SellerLedgerTypeSettle      = "settle"
	SellerLedgerTypeRefund      = "refund"

	SellerLedgerStatusPending   = "pending"
	SellerLedgerStatusFrozen    = "frozen"
	SellerLedgerStatusSettled   = "settled"
	SellerLedgerStatusCompleted = "completed"
)

// Real-name verification statuses (§5.10)
const (
	UserVerificationStatusUnverified = "unverified"
	UserVerificationStatusPending    = "pending"
	UserVerificationStatusVerified   = "verified"
	UserVerificationStatusRejected   = "rejected"
)

// FormatTokenPackageGroup returns the canonical group identifier for a package token.
func FormatTokenPackageGroup(packageID int) string {
	return TokenPackageGroupPrefix + strconv.Itoa(packageID)
}

// ParseTokenPackageGroup parses a canonical "pkg:<id>" group name into a positive package ID.
func ParseTokenPackageGroup(group string) (int, bool) {
	after, ok := strings.CutPrefix(group, TokenPackageGroupPrefix)
	if !ok || after == "" {
		return 0, false
	}
	id, err := strconv.Atoi(after)
	if err != nil || id <= 0 || strconv.Itoa(id) != after {
		return 0, false
	}
	return id, true
}

// HasReservedPackageGroupPrefix reports whether a group name uses the reserved "pkg:" prefix.
func HasReservedPackageGroupPrefix(group string) bool {
	trimmed := strings.TrimSpace(group)
	return strings.HasPrefix(strings.ToLower(trimmed), TokenPackageGroupPrefix)
}
