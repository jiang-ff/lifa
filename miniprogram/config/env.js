const ENV_STORAGE_KEY = "runtime_env_profile"

const ENV_PROFILES = {
  test: {
    key: "test",
    label: "测试环境",
    cloudEnvId: "cloud1-d6gmq1pam45528b5f",
    description: "开发版与体验版默认使用"
  },
  prod: {
    key: "prod",
    label: "生产环境",
    cloudEnvId: "cloud1-d6gmq1pam45528b5f",
    description: "正式版固定使用，上线前请替换为正式环境 ID"
  }
}

function getMiniProgramStage() {
  try {
    const info = wx.getAccountInfoSync?.()
    return info?.miniProgram?.envVersion || "develop"
  } catch (error) {
    return "develop"
  }
}

function normalizeProfile(profile) {
  if (profile === "prod") return "prod"
  if (profile === "test") return "test"
  return ""
}

function getDefaultProfile(stage) {
  return stage === "release" ? "prod" : "test"
}

function getStoredProfile() {
  try {
    return normalizeProfile(wx.getStorageSync(ENV_STORAGE_KEY))
  } catch (error) {
    return ""
  }
}

function listEnvProfiles() {
  return Object.keys(ENV_PROFILES).map((key) => ({
    key,
    label: ENV_PROFILES[key].label,
    cloudEnvId: ENV_PROFILES[key].cloudEnvId,
    description: ENV_PROFILES[key].description
  }))
}

function resolveRuntimeEnv(options = {}) {
  const stage = getMiniProgramStage()
  const isRelease = stage === "release"
  const requestedProfile = normalizeProfile(options.profile)
  const storedProfile = getStoredProfile()
  const defaultProfile = getDefaultProfile(stage)
  const profile = isRelease ? "prod" : normalizeProfile(requestedProfile || storedProfile || defaultProfile)
  const profileConfig = ENV_PROFILES[profile] || ENV_PROFILES.test

  return {
    stage,
    isRelease,
    canSwitch: !isRelease,
    profile,
    label: profileConfig.label,
    cloudEnvId: profileConfig.cloudEnvId,
    description: profileConfig.description,
    hasManualOverride: !isRelease && profile !== defaultProfile,
    defaultProfile,
    profiles: listEnvProfiles()
  }
}

function persistRuntimeEnvProfile(profile) {
  const stage = getMiniProgramStage()
  if (stage === "release") return
  wx.setStorageSync(ENV_STORAGE_KEY, normalizeProfile(profile) || "test")
}

function clearRuntimeEnvProfile() {
  try {
    wx.removeStorageSync(ENV_STORAGE_KEY)
  } catch (error) {
    return
  }
}

module.exports = {
  ENV_STORAGE_KEY,
  ENV_PROFILES,
  getMiniProgramStage,
  listEnvProfiles,
  resolveRuntimeEnv,
  persistRuntimeEnvProfile,
  clearRuntimeEnvProfile
}
