package controller

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUserAvatarUploadStoresAndServesImage(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	t.Setenv("AVATAR_STORAGE_DIR", t.TempDir())

	message, firstURL := uploadAvatarForTest(t, user.Id, "first.png", avatarPNGForTest(t))
	require.Empty(t, message)
	assert.True(t, strings.HasPrefix(firstURL, "/api/avatar/"), firstURL)
	firstPath, ok := service.AvatarFilePath(filepath.Base(firstURL))
	require.True(t, ok)
	_, err := os.Stat(firstPath)
	require.NoError(t, err)

	stored, err := model.GetUserById(user.Id, false)
	require.NoError(t, err)
	assert.Equal(t, firstURL, stored.GetSetting().AvatarUrl)

	message, secondURL := uploadAvatarForTest(t, user.Id, "second.png", avatarPNGForTest(t))
	require.Empty(t, message)
	assert.NotEqual(t, firstURL, secondURL)
	_, err = os.Stat(firstPath)
	assert.ErrorIs(t, err, os.ErrNotExist, "replaced avatar should be removed")

	router := gin.New()
	router.GET("/api/avatar/:filename", GetUserAvatar)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, secondURL, nil)
	router.ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "image/png", response.Header().Get("Content-Type"))
	assert.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
	assert.Contains(t, response.Header().Get("Cache-Control"), "immutable")
	assert.NotEmpty(t, response.Body.Bytes())
}

func TestUserAvatarUploadRejectsUnsupportedAndOversizedFiles(t *testing.T) {
	user, _ := setupSecurityEnrollmentTest(t)
	t.Setenv("AVATAR_STORAGE_DIR", t.TempDir())

	invalidMessage, invalidURL := uploadAvatarForTest(t, user.Id, "note.txt", []byte("not an image"))
	assert.Equal(t, "Unsupported image format", invalidMessage)
	assert.Empty(t, invalidURL)

	oversizedMessage, oversizedURL := uploadAvatarForTest(t, user.Id, "huge.png", bytes.Repeat([]byte{0}, int(service.AvatarUploadLimit)+1))
	assert.Equal(t, "Image is too large", oversizedMessage)
	assert.Empty(t, oversizedURL)

	// A small file can still describe a decompression bomb; the service
	// rejects it by declared dimensions before decoding every pixel.
	wideMessage, wideURL := uploadAvatarForTest(t, user.Id, "wide.png", avatarPNGSizeForTest(t, 4097, 1))
	assert.Equal(t, "Image is too large", wideMessage)
	assert.Empty(t, wideURL)

	stored, err := model.GetUserById(user.Id, false)
	require.NoError(t, err)
	assert.Empty(t, stored.GetSetting().AvatarUrl)
}

func TestUserAvatarRouteRejectsNamesOutsideServerTokens(t *testing.T) {
	router := gin.New()
	router.GET("/api/avatar/:filename", GetUserAvatar)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/avatar/../../etc/passwd", nil))

	assert.Equal(t, http.StatusNotFound, response.Code)
}

func TestUserAvatarRouteDoesNotCacheMissingFiles(t *testing.T) {
	t.Setenv("AVATAR_STORAGE_DIR", t.TempDir())
	router := gin.New()
	router.GET("/api/avatar/:filename", GetUserAvatar)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/avatar/0123456789abcdef0123456789abcdef.png", nil))

	assert.Equal(t, http.StatusNotFound, response.Code)
	assert.Empty(t, response.Header().Get("Cache-Control"))
}

func uploadAvatarForTest(t *testing.T, userID int, filename string, content []byte) (string, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("avatar", filename)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/user/avatar", &body)
	context.Request.Header.Set("Content-Type", writer.FormDataContentType())
	context.Set("id", userID)
	context.Set("role", common.RoleCommonUser)
	UpdateUserAvatar(context)

	var result struct {
		Message string `json:"message"`
		Data    struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	return result.Message, result.Data.AvatarURL
}

func avatarPNGForTest(t *testing.T) []byte {
	t.Helper()
	return avatarPNGSizeForTest(t, 64, 64)
}

func avatarPNGSizeForTest(t *testing.T, width, height int) []byte {
	t.Helper()
	imageData := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := range height {
		for x := range width {
			imageData.Set(x, y, color.RGBA{R: uint8(x * 4), G: uint8(y * 4), B: 128, A: 255})
		}
	}
	var buffer bytes.Buffer
	require.NoError(t, png.Encode(&buffer, imageData))
	return buffer.Bytes()
}
