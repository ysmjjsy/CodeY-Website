package vertex

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

const (
	DefaultAPIVersion    = "v1"
	OpenSourceAPIVersion = "v1beta1"
	PublisherGoogle      = "google"
	PublisherAnthropic   = "anthropic"
)

func normalizeVertexBaseURL(baseURL string) string {
	return strings.TrimRight(strings.TrimSpace(baseURL), "/")
}

// vertexRegionPattern matches Vertex location ids such as "us-central1",
// "global", "us" or "eu".
var vertexRegionPattern = regexp.MustCompile(`^[a-z0-9-]{1,64}$`)

// IsValidVertexRegion reports whether a region can only ever name a location.
// The region becomes part of the upstream host name, so anything else could
// point a request at a different host.
func IsValidVertexRegion(region string) bool {
	return vertexRegionPattern.MatchString(strings.TrimSpace(region))
}

// IsValidVertexRegionConfig checks a channel's region setting: a single region,
// or a JSON object mapping model names (and "default") to regions.
func IsValidVertexRegionConfig(other string) bool {
	other = strings.TrimSpace(other)
	if other == "" {
		return true
	}
	if !common.IsJsonObject(other) {
		return IsValidVertexRegion(other)
	}
	regions, err := common.StrToMap(other)
	if err != nil {
		return false
	}
	for _, value := range regions {
		region, ok := value.(string)
		if !ok || !IsValidVertexRegion(region) {
			return false
		}
	}
	return true
}

func normalizeVertexRegion(region string) string {
	region = strings.TrimSpace(region)
	// A region that is not a plain location id falls back to the global
	// endpoint instead of being placed into the host name.
	if region == "" || !IsValidVertexRegion(region) {
		return "global"
	}
	return region
}

func appendVertexAPIVersion(baseURL, version string) string {
	version = strings.Trim(strings.TrimSpace(version), "/")
	if version == "" {
		return baseURL
	}
	if strings.HasSuffix(baseURL, "/"+version) {
		return baseURL
	}
	return baseURL + "/" + version
}

func BuildAPIBaseURL(baseURL, version, projectID, region string) string {
	if normalized := normalizeVertexBaseURL(baseURL); normalized != "" {
		normalized = appendVertexAPIVersion(normalized, version)

		region = normalizeVertexRegion(region)
		if strings.TrimSpace(projectID) != "" {
			normalized = fmt.Sprintf("%s/projects/%s/locations/%s", normalized, projectID, region)
		}
		return normalized
	}

	region = normalizeVertexRegion(region)
	host := region + "-aiplatform.googleapis.com"
	switch region {
	case "global":
		host = "aiplatform.googleapis.com"
	case "us", "eu":
		// The US and EU multi-regions are served from their own hostnames.
		host = "aiplatform." + region + ".rep.googleapis.com"
	}
	if strings.TrimSpace(projectID) == "" {
		return fmt.Sprintf("https://%s/%s", host, version)
	}
	return fmt.Sprintf("https://%s/%s/projects/%s/locations/%s", host, version, projectID, region)
}

func BuildPublisherModelURL(baseURL, version, projectID, region, publisher, modelName, action string) string {
	return fmt.Sprintf(
		"%s/publishers/%s/models/%s:%s",
		BuildAPIBaseURL(baseURL, version, projectID, region),
		publisher,
		modelName,
		action,
	)
}

func BuildGoogleModelURL(baseURL, version, projectID, region, modelName, action string) string {
	return BuildPublisherModelURL(baseURL, version, projectID, region, PublisherGoogle, modelName, action)
}

func BuildAnthropicModelURL(baseURL, version, projectID, region, modelName, action string) string {
	return BuildPublisherModelURL(baseURL, version, projectID, region, PublisherAnthropic, modelName, action)
}

func BuildOpenSourceChatCompletionsURL(baseURL, projectID, region string) string {
	return fmt.Sprintf(
		"%s/endpoints/openapi/chat/completions",
		BuildAPIBaseURL(baseURL, OpenSourceAPIVersion, projectID, region),
	)
}
