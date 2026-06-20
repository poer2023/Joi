package appcore

import "strings"

type PermissionProfile string

const (
	PermissionProfileReadOnly         PermissionProfile = "read_only"
	PermissionProfileWorkspaceWrite   PermissionProfile = "workspace_write"
	PermissionProfileDangerFullAccess PermissionProfile = "danger_full_access"
)

func normalizedPermissionProfile(value string) PermissionProfile {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(PermissionProfileWorkspaceWrite):
		return PermissionProfileWorkspaceWrite
	case string(PermissionProfileDangerFullAccess):
		return PermissionProfileDangerFullAccess
	default:
		return PermissionProfileReadOnly
	}
}

func permissionProfileAllowsFileRead(profile PermissionProfile) bool {
	switch profile {
	case PermissionProfileReadOnly, PermissionProfileWorkspaceWrite, PermissionProfileDangerFullAccess:
		return true
	default:
		return false
	}
}

func permissionProfileAllowsWorkspaceWrite(profile PermissionProfile) bool {
	switch profile {
	case PermissionProfileWorkspaceWrite, PermissionProfileDangerFullAccess:
		return true
	default:
		return false
	}
}

func maxToolRiskForPermissionProfile(profile PermissionProfile) string {
	if profile == PermissionProfileDangerFullAccess {
		return "browser_interaction"
	}
	if permissionProfileAllowsWorkspaceWrite(profile) {
		return "workspace_write"
	}
	return "read_only"
}
