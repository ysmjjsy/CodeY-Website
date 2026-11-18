package middleware

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/token_package_setting"
	"github.com/gin-gonic/gin"
)

// MarketplaceEnabled rejects marketplace calls while the operator switch is off.
func MarketplaceEnabled() gin.HandlerFunc {
	return func(c *gin.Context) {
		if token_package_setting.IsEnabled() {
			c.Next()
			return
		}
		abortWithWebMessage(c, http.StatusForbidden, "TOKEN_PACKAGE_DISABLED", common.NewMessage("The token package marketplace is not enabled"))
	}
}

// SellerAuth requires an eligible seller for publishing writes. Eligibility is
// re-evaluated from the database on every request so a ban, a verification
// revocation or a group change takes effect immediately.
func SellerAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		userId := c.GetInt("id")
		if userId <= 0 {
			abortWithWebMessage(c, http.StatusUnauthorized, "AUTH_UNAUTHORIZED", common.NewMessage("Unauthorized, not logged in and no access token provided"))
			return
		}
		eligibility, err := service.EvaluateSellerEligibility(userId)
		if err != nil {
			common.SysLog(common.LogText("seller eligibility check failed: %s", err.Error()))
			abortWithWebMessage(c, http.StatusInternalServerError, "AUTH_INTERNAL_ERROR", common.NewMessage("Database error, please contact the administrator"))
			return
		}
		if !eligibility.Eligible {
			message := common.NewMessage("Seller publishing permission is unavailable.")
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"success":        false,
				"code":           "SELLER_NOT_ELIGIBLE",
				"message":        message.Error(),
				"message_key":    message.Key,
				"message_params": message.Params,
				"reason":         eligibility.Reason,
			})
			return
		}
		c.Set("seller_eligibility", eligibility)
		c.Next()
	}
}
