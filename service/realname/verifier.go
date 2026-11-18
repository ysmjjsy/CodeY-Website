package realname

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
)

const (
	// RealnameHashSecretEnv holds the HMAC key used to hash government ID numbers
	// for same-identity wash-trading detection without storing plaintext IDs.
	RealnameHashSecretEnv = "REALNAME_HASH_SECRET"

	ProviderManual = "manual"
	// CurrentConsentVersion names the consent text a submission agreed to. It
	// changed when purchases started to require verification, because the
	// earlier text only covered seller eligibility.
	CurrentConsentVersion = "2026-11-18.2"
)

var (
	ErrHashSecretNotConfigured = errors.New("real-name hash secret is not configured")
	ErrInvalidRealnameInput    = errors.New("real name and ID number are required")
	ErrInvalidIDNumber         = errors.New("invalid ID number format")
	ErrConsentRequired         = errors.New("privacy consent is required")

	idNumberPattern = regexp.MustCompile(`^[A-Z0-9]{6,32}$`)
	// chineseIDWeights are the GB 11643 weights of the first 17 digits.
	chineseIDWeights = []int{7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2}
	chineseIDChecks  = []byte("10X98765432")
)

// VerifyRequest represents an in-memory real-name verification payload.
// Plaintext IDNumber MUST NEVER be persisted or logged.
type VerifyRequest struct {
	UserID         int
	RealName       string
	IDNumber       string
	Consent        bool
	ConsentVersion string
}

// VerifyResult contains the minimized verification attributes safe for storage.
type VerifyResult struct {
	Status          string
	Provider        string
	ProviderTraceID string
	MaskedName      string
	IDNumberHash    string
	VerifiedAt      int64
}

// Verifier defines the pluggable identity verification provider boundary.
type Verifier interface {
	Name() string
	Verify(ctx context.Context, req VerifyRequest) (*VerifyResult, error)
}

// ManualAdminVerifier is the P0 real-name verifier backed by offline admin review.
type ManualAdminVerifier struct{}

func (ManualAdminVerifier) Name() string {
	return ProviderManual
}

func (ManualAdminVerifier) Verify(_ context.Context, req VerifyRequest) (*VerifyResult, error) {
	if req.UserID <= 0 {
		return nil, ErrInvalidRealnameInput
	}
	trimmedName := strings.TrimSpace(req.RealName)
	if trimmedName == "" {
		return nil, ErrInvalidRealnameInput
	}
	hash, err := HashIDNumber(req.IDNumber)
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	return &VerifyResult{
		Status:          constant.UserVerificationStatusVerified,
		Provider:        ProviderManual,
		ProviderTraceID: fmt.Sprintf("manual-%d-%d", req.UserID, now),
		MaskedName:      MaskName(trimmedName),
		IDNumberHash:    hash,
		VerifiedAt:      now,
	}, nil
}

// DefaultVerifier returns the active P0 verifier implementation.
func DefaultVerifier() Verifier {
	return ManualAdminVerifier{}
}

// IsHashSecretConfigured reports whether REALNAME_HASH_SECRET is non-empty.
func IsHashSecretConfigured() bool {
	return strings.TrimSpace(os.Getenv(RealnameHashSecretEnv)) != ""
}

// HashIDNumber computes the non-reversible HMAC-SHA256 digest of a normalized ID
// number using REALNAME_HASH_SECRET.
func HashIDNumber(idNumber string) (string, error) {
	secret := strings.TrimSpace(os.Getenv(RealnameHashSecretEnv))
	if secret == "" {
		return "", ErrHashSecretNotConfigured
	}
	normalized, err := NormalizeIDNumber(idNumber)
	if err != nil {
		return "", err
	}
	return common.GenerateHMACWithKey([]byte(secret), normalized), nil
}

// NormalizeIDNumber strips separators and casing differences so the same
// document always hashes to the same value, then checks the shape. An
// 18-character number whose first 17 characters are digits is a Chinese
// resident ID and must carry a valid check digit; anything else is accepted
// only as 6 to 32 letters and digits.
func NormalizeIDNumber(idNumber string) (string, error) {
	var builder strings.Builder
	for _, r := range idNumber {
		if unicode.IsSpace(r) || r == '-' || r == '_' {
			continue
		}
		builder.WriteRune(unicode.ToUpper(r))
	}
	normalized := builder.String()
	if normalized == "" {
		return "", ErrInvalidRealnameInput
	}
	if !idNumberPattern.MatchString(normalized) {
		return "", ErrInvalidIDNumber
	}
	if len(normalized) == 18 && isAllDigits(normalized[:17]) {
		if !validChineseResidentID(normalized) {
			return "", ErrInvalidIDNumber
		}
	}
	return normalized, nil
}

func isAllDigits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return value != ""
}

// validChineseResidentID checks the GB 11643 check digit. The check digit is
// the only thing that stops a seller from minting a fresh identity by editing
// one character of a real number.
func validChineseResidentID(id string) bool {
	if len(id) != 18 {
		return false
	}
	sum := 0
	for i, weight := range chineseIDWeights {
		digit, err := strconv.Atoi(id[i : i+1])
		if err != nil {
			return false
		}
		sum += digit * weight
	}
	return id[17] == chineseIDChecks[sum%11]
}

// MaskName masks all characters of a real name except the leading rune.
func MaskName(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) == 1 {
		return "*"
	}
	return string(runes[0]) + strings.Repeat("*", len(runes)-1)
}

// Submission is the minimized form of a real-name submission that is waiting
// for administrator review. It carries no plaintext identity attributes.
type Submission struct {
	MaskedName   string
	IDNumberHash string
}

// PrepareSubmission validates an in-memory verification payload and returns the
// attributes allowed to reach storage. The plaintext ID number is discarded
// once its HMAC digest is computed.
func PrepareSubmission(req VerifyRequest) (*Submission, error) {
	if req.UserID <= 0 {
		return nil, ErrInvalidRealnameInput
	}
	name := strings.TrimSpace(req.RealName)
	if name == "" || len([]rune(name)) > 64 {
		return nil, ErrInvalidRealnameInput
	}
	if !req.Consent {
		return nil, ErrConsentRequired
	}
	if strings.TrimSpace(req.ConsentVersion) != CurrentConsentVersion {
		return nil, ErrConsentRequired
	}
	hash, err := HashIDNumber(req.IDNumber)
	if err != nil {
		return nil, err
	}
	return &Submission{MaskedName: MaskName(name), IDNumberHash: hash}, nil
}
