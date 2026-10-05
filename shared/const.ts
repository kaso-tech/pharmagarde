export const COOKIE_NAME = "app_session_id";
/** Durée de vie d'une session (jeton et cookie). Au-delà, l'utilisateur se reconnecte. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Please login (10001)";
export const NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
