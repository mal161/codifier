import { Router, type Request, type Response } from "express";
import { addToCart, getCart } from "../services/cartService";
import { cartRepository } from "../db/cartRepository";

const router = Router();

router.get("/", showCart);
router.post("/items", addItem);
router.delete("/", clearCart);

function showCart(_request: Request, response: Response) {
  response.json(getCart(response.locals.userId));
}

function addItem(request: Request, response: Response) {
  response
    .status(201)
    .json(addToCart(response.locals.userId, request.body.productId, 1));
}

function clearCart(_request: Request, response: Response) {
  cartRepository.delete(response.locals.userId);
  response.status(204).end();
}

export { router as cartRouter };
