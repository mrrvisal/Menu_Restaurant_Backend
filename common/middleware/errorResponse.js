const {
  formatError,
  inferErrorCode,
  resolveLanguage,
} = require("../locales/errors");

function sendError(req, res, status, code, message) {
  const language = resolveLanguage(req);
  res.set("Content-Language", language);
  return res.status(status).json({
    success: false,
    error: formatError(inferErrorCode(code, message, status), message),
  });
}

function normalizeErrorResponses(req, res, next) {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    const language = resolveLanguage(req);
    res.set("Content-Language", language);

    const isError =
      res.statusCode >= 400 || body?.success === false || body?.error != null;
    if (!isError) return sendJson(body);

    if (
      body?.success === false &&
      body.error?.message &&
      typeof body.error.message === "object"
    ) {
      return sendJson(body);
    }

    // Keep the controller's SPECIFIC text (bilingual when we have a vetted
    // translation) and preserve extra fields — e.g. `code: "DUPLICATE_
    // RESTAURANT"` that the dashboard checks — which the old rewrite dropped.
    const specific =
      typeof body?.error === "string"
        ? body.error
        : typeof body?.message === "string"
          ? body.message
          : undefined;
    return sendJson({
      ...body,
      success: false,
      error: formatError(
        inferErrorCode(
          body?.code,
          body?.error || body?.message,
          res.statusCode,
        ),
        specific,
      ),
    });
  };

  next();
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const status =
    err.status ||
    err.statusCode ||
    (err.message === "Only images allowed" ? 400 : 500);
  const code =
    err.code === "LIMIT_FILE_SIZE"
      ? "REQUEST_TOO_LARGE"
      : err.message === "Only images allowed"
        ? "FILE_TYPE_NOT_ALLOWED"
        : undefined;

  if (status >= 500) console.error("Request failed:", err.message);
  return sendError(req, res, status, code, err.message);
}

module.exports = { errorHandler, normalizeErrorResponses };
