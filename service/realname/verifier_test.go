package realname

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeIDNumberCollapsesEquivalentDocuments(t *testing.T) {
	// 110101199003078873 carries a valid GB 11643 check digit.
	const residentID = "110101199003078873"

	plain, err := NormalizeIDNumber(residentID)
	require.NoError(t, err)

	separated, err := NormalizeIDNumber("110101 19900307-8873")
	require.NoError(t, err)
	assert.Equal(t, plain, separated, "spaces and dashes must not mint a second identity")

	lower, err := NormalizeIDNumber("ab12-cd34")
	require.NoError(t, err)
	upper, err := NormalizeIDNumber("AB12CD34")
	require.NoError(t, err)
	assert.Equal(t, lower, upper)
}

func TestNormalizeIDNumberRejectsABrokenCheckDigit(t *testing.T) {
	_, err := NormalizeIDNumber("110101199003078874")
	assert.ErrorIs(t, err, ErrInvalidIDNumber, "one changed digit must not pass as a new person")

	_, err = NormalizeIDNumber("ABC12")
	assert.ErrorIs(t, err, ErrInvalidIDNumber)

	_, err = NormalizeIDNumber("   ")
	assert.ErrorIs(t, err, ErrInvalidRealnameInput)
}

func TestHashIDNumberUsesTheNormalizedForm(t *testing.T) {
	t.Setenv(RealnameHashSecretEnv, "test-secret")

	first, err := HashIDNumber("110101199003078873")
	require.NoError(t, err)
	second, err := HashIDNumber("110101-19900307-8873")
	require.NoError(t, err)
	assert.Equal(t, first, second, "the same document hashes once, whatever the separators")

	_, err = HashIDNumber("110101199003078874")
	assert.ErrorIs(t, err, ErrInvalidIDNumber)
}
