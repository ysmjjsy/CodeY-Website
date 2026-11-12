package service

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const (
	// AvatarUploadLimit bounds the bytes accepted for one avatar upload.
	AvatarUploadLimit int64 = 5 << 20
	// avatarOutputSize is the square edge written to disk. The account card
	// renders at most ~112 CSS px, so 512 px covers high-density displays.
	avatarOutputSize        = 512
	avatarMaxSourceEdge     = 4096
	avatarMaxSourcePixels   = 16_000_000
	avatarStorageDirEnvName = "AVATAR_STORAGE_DIR"
)

var (
	ErrAvatarTooLarge     = errors.New("avatar image is too large")
	ErrAvatarUnsupported  = errors.New("avatar image format is not supported")
	avatarFileNamePattern = regexp.MustCompile(`^[a-f0-9]{32}\.png$`)
)

// AvatarStorageDir is the directory where uploaded avatars are kept. It is
// node-local: a multi-node deployment needs to point every node at shared
// storage (for example a shared volume) through AVATAR_STORAGE_DIR.
func AvatarStorageDir() string {
	dir := strings.TrimSpace(os.Getenv(avatarStorageDirEnvName))
	if dir == "" {
		dir = filepath.Join("upload", "avatars")
	}
	return dir
}

// SaveAvatar validates and normalizes an uploaded image, then stores it as a
// square PNG named with an unguessable token. Only the URL is persisted.
func SaveAvatar(source io.Reader) (string, error) {
	data, err := io.ReadAll(io.LimitReader(source, AvatarUploadLimit+1))
	if err != nil {
		return "", err
	}
	if int64(len(data)) > AvatarUploadLimit {
		return "", ErrAvatarTooLarge
	}

	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return "", ErrAvatarUnsupported
	}
	switch format {
	case "png", "jpeg", "webp", "gif":
	default:
		return "", ErrAvatarUnsupported
	}
	if config.Width <= 0 || config.Height <= 0 ||
		config.Width > avatarMaxSourceEdge || config.Height > avatarMaxSourceEdge ||
		int64(config.Width)*int64(config.Height) > avatarMaxSourcePixels {
		return "", ErrAvatarTooLarge
	}

	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", ErrAvatarUnsupported
	}

	var encoded bytes.Buffer
	if err := png.Encode(&encoded, squareAvatar(decoded)); err != nil {
		return "", err
	}

	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		return "", err
	}
	name := hex.EncodeToString(token) + ".png"
	if err := writeAvatarFile(name, encoded.Bytes()); err != nil {
		return "", err
	}
	return AvatarURL(name), nil
}

// AvatarURL is the public, cacheable location of a stored avatar.
func AvatarURL(name string) string {
	return "/api/avatar/" + name
}

// AvatarFilePath resolves a request parameter to a stored avatar, rejecting
// any name that is not one of the server-generated tokens.
func AvatarFilePath(name string) (string, bool) {
	if !avatarFileNamePattern.MatchString(name) {
		return "", false
	}
	return filepath.Join(AvatarStorageDir(), name), true
}

// RemoveAvatarFile deletes the stored file referenced by an avatar URL. It is
// best-effort cleanup: unknown URLs and missing files are ignored.
func RemoveAvatarFile(avatarURL string) {
	name := filepath.Base(strings.TrimSpace(avatarURL))
	if !avatarFileNamePattern.MatchString(name) {
		return
	}
	_ = os.Remove(filepath.Join(AvatarStorageDir(), name))
}

func squareAvatar(source image.Image) image.Image {
	bounds := source.Bounds()
	side := min(bounds.Dx(), bounds.Dy())
	offsetX := bounds.Min.X + (bounds.Dx()-side)/2
	offsetY := bounds.Min.Y + (bounds.Dy()-side)/2
	sourceRect := image.Rect(offsetX, offsetY, offsetX+side, offsetY+side)

	target := image.NewRGBA(image.Rect(0, 0, avatarOutputSize, avatarOutputSize))
	draw.CatmullRom.Scale(target, target.Bounds(), source, sourceRect, draw.Src, nil)
	return target
}

func writeAvatarFile(name string, data []byte) error {
	dir := AvatarStorageDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(dir, ".avatar-*.tmp")
	if err != nil {
		return err
	}
	tempName := temp.Name()
	cleanup := func() {
		_ = temp.Close()
		_ = os.Remove(tempName)
	}
	if _, err := temp.Write(data); err != nil {
		cleanup()
		return err
	}
	if err := temp.Chmod(0o644); err != nil {
		cleanup()
		return err
	}
	if err := temp.Close(); err != nil {
		_ = os.Remove(tempName)
		return err
	}
	if err := os.Rename(tempName, filepath.Join(dir, name)); err != nil {
		_ = os.Remove(tempName)
		return err
	}
	return nil
}
