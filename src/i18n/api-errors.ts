import type { Locale } from './ui'

const messages: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    invalid_credentials: '用户名、邮箱或密码不正确。',
    account_disabled: '当前账号已被禁用，请联系管理员。',
    invalid_account: '账号信息格式不正确，请检查后重试。',
    identity_exists: '用户名或邮箱已被注册。',
    authentication_required: '请先登录后继续操作。',
    administrator_required: '当前账号没有管理员权限。',
    origin_required: '请求来源无效，请刷新页面后重试。',
    origin_mismatch: '请求来源不受信任，请从官网重新发起操作。',
    github_disabled: 'GitHub 登录尚未配置。',
    github_denied: 'GitHub 授权已取消。',
    github_code_required: 'GitHub 授权信息不完整，请重新登录。',
    github_state_required: 'GitHub 登录状态已失效，请重新登录。',
    github_state_invalid: 'GitHub 登录状态无效，请重新登录。',
    github_token_exchange: 'GitHub 登录验证失败，请稍后重试。',
    github_identity: '暂时无法读取 GitHub 账号信息。',
    github_transport: '暂时无法连接 GitHub。',
    github_url: 'GitHub 登录地址生成失败。',
    invalid_multipart: '上传请求格式不正确。',
    invalid_archive: '模板文件无效或已损坏。',
    archive_required: '请选择需要上传的模板文件。',
    archive_too_large: '模板文件超过大小限制。',
    upload_not_found: '上传记录不存在或已过期，请重新上传。',
    upload_owner_mismatch: '该上传记录不属于当前账号。',
    invalid_primary_resource: '选择的主资源不在模板包中。',
    upload_integrity: '上传文件校验失败，请重新上传。',
    artifact_integrity: '服务器中的模板制品校验失败。',
    invalid_listing_metadata: '模板展示信息不符合要求。',
    version_conflict: '该模板版本已经存在。',
    publisher_conflict: '该模板属于其他发布者。',
    submission_pending: '该模板版本已经在审核中。',
    submission_transition: '模板审核状态已经发生变化，请刷新后重试。',
    submission_already_reviewed: '该模板已经完成审核。',
    submission_not_found: '审核记录不存在。',
    review_note_too_long: '审核备注不能超过 1000 个字符。',
    listing_not_found: '模板不存在或已下架。',
    release_not_found: '模板版本不存在。',
    marketplace_store: '模板市场数据服务暂时不可用。',
    marketplace_auth: '账号服务暂时不可用。',
    marketplace_io: '服务器文件服务暂时不可用。',
    response_header: '服务器响应异常，请稍后重试。',
  },
  en: {
    invalid_credentials: 'The username, email, or password is incorrect.',
    account_disabled: 'This account has been disabled. Contact an administrator.',
    invalid_account: 'Check the account details and try again.',
    identity_exists: 'The username or email is already registered.',
    authentication_required: 'Sign in to continue.',
    administrator_required: 'This account does not have administrator access.',
    origin_required: 'The request source is invalid. Refresh the page and try again.',
    origin_mismatch: 'The request source is not trusted. Start again from the website.',
    github_disabled: 'GitHub sign-in is not configured.',
    github_denied: 'GitHub authorization was cancelled.',
    github_code_required: 'GitHub authorization is incomplete. Sign in again.',
    github_state_required: 'The GitHub sign-in session expired. Sign in again.',
    github_state_invalid: 'The GitHub sign-in session is invalid. Sign in again.',
    github_token_exchange: 'GitHub sign-in verification failed. Try again later.',
    github_identity: 'GitHub account information is temporarily unavailable.',
    github_transport: 'GitHub is temporarily unreachable.',
    github_url: 'The GitHub sign-in URL could not be created.',
    invalid_multipart: 'The upload request format is invalid.',
    invalid_archive: 'The template file is invalid or damaged.',
    archive_required: 'Choose a template file to upload.',
    archive_too_large: 'The template file exceeds the size limit.',
    upload_not_found: 'The upload does not exist or has expired. Upload it again.',
    upload_owner_mismatch: 'This upload belongs to another account.',
    invalid_primary_resource: 'The selected primary resource is not in the package.',
    upload_integrity: 'Upload verification failed. Upload the file again.',
    artifact_integrity: 'The stored template artifact failed verification.',
    invalid_listing_metadata: 'The template listing details are invalid.',
    version_conflict: 'This template version already exists.',
    publisher_conflict: 'This template belongs to another publisher.',
    submission_pending: 'This template version is already under review.',
    submission_transition: 'The review status changed. Refresh and try again.',
    submission_already_reviewed: 'This template has already been reviewed.',
    submission_not_found: 'The review submission was not found.',
    review_note_too_long: 'The review note cannot exceed 1,000 characters.',
    listing_not_found: 'The template does not exist or is no longer available.',
    release_not_found: 'The template release was not found.',
    marketplace_store: 'The marketplace data service is temporarily unavailable.',
    marketplace_auth: 'The account service is temporarily unavailable.',
    marketplace_io: 'The server file service is temporarily unavailable.',
    response_header: 'The server returned an invalid response. Try again later.',
  },
}

const statusCodes: Record<number, string> = {
  401: 'authentication_required',
  403: 'administrator_required',
  413: 'archive_too_large',
}

export async function localizedApiError(
  response: Response,
  locale: Locale,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { code?: string } }
    const code = payload.error?.code || statusCodes[response.status]
    return (code && messages[locale][code]) || fallback
  } catch {
    const code = statusCodes[response.status]
    return (code && messages[locale][code]) || fallback
  }
}
