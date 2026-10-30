export function listUsers() {
  return [];
}

const router = {
  get(_path: string, _handler: () => unknown) {},
  post(_path: string, _handler: () => unknown) {},
};

router.get("/users", listUsers);
router.post("/users", (_request, _response) => []);
