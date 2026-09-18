import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware to log every incoming HTTP request and its completion details.
 * Logs method, URL path, client IP, response status code, and duration in milliseconds.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  const { method, originalUrl } = req;
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const startTimestamp = new Date().toISOString();

  // Log incoming request
  console.log(`[HTTP] [${startTimestamp}] --> ${method} ${originalUrl} (from ${clientIp})`);

  // Log outgoing response when the stream finishes
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    const statusLevel = statusCode >= 500 ? "ERROR" : statusCode >= 400 ? "WARN" : "INFO";

    console.log(
      `[HTTP] [${new Date().toISOString()}] <-- ${method} ${originalUrl} ${statusCode} [${statusLevel}] (${duration}ms)`
    );
  });

  next();
}

export default requestLogger;

