package authz

const (
	ResourceTokenPackage = "token_package"

	ActionReview = "review"
)

var (
	TokenPackageRead    = Permission{Resource: ResourceTokenPackage, Action: ActionRead}
	TokenPackageReview  = Permission{Resource: ResourceTokenPackage, Action: ActionReview}
	TokenPackageOperate = Permission{Resource: ResourceTokenPackage, Action: ActionOperate}
)

func init() {
	RegisterResource(ResourceDefinition{
		Resource: ResourceTokenPackage,
		LabelKey: "Token Packages",
		Actions: []ActionDefinition{
			{
				Action:         ActionRead,
				LabelKey:       "Read token packages",
				DescriptionKey: "View token package reviews, listings, sellers, and verification records.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionReview,
				LabelKey:       "Review token packages",
				DescriptionKey: "Approve or reject submitted token package versions and real-name verifications.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
			{
				Action:         ActionOperate,
				LabelKey:       "Operate token packages",
				DescriptionKey: "Pause or terminate token packages and manage seller publish restrictions or commissions.",
				DefaultRoles:   []string{BuiltInRoleAdmin},
			},
		},
	})
}
