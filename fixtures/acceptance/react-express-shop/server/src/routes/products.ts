import { Router, type Request, type Response } from "express";
import { getProduct, listProducts } from "../services/productService";

const router = Router();

router.get("/", listHandler);
router.get("/:id", getHandler);

function listHandler(_request: Request, response: Response) {
  response.json(listProducts());
}

function getHandler(request: Request, response: Response) {
  const product = getProduct(request.params.id);
  if (!product) {
    response.status(404).json({ error: "product_not_found" });
    return;
  }
  response.json(product);
}

export { router as productsRouter };
