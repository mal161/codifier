import type { NextFunction, Request, Response } from "express";

export function requireUser(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const userId = request.header("x-user-id");
  if (!userId) {
    response.status(401).json({ error: "missing_user" });
    return;
  }
  response.locals.userId = userId;
  next();
}
