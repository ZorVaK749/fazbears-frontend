// Exclusivamente datos sintéticos para pruebas offline. No importan usuarios reales.
export const ORDER = String.raw`[
  {"id":9007199254740993,"usuarioId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
   "emailUsuario":"fixture@example.invalid","fechaCreacion":"2026-11-12T10:00:00.123456",
   "total":24.68,"estado":"CANCELADO","items":[
    {"id":9007199254740997,"productoId":7,"nombreProducto":"Pizza O'Reilly; \\ menú",
     "cantidad":2,"precioUnitario":12.34}
   ]}
]`;
export const CART = String.raw`[
  {"id":9007199254740993,"usuarioId":"historical-alias-not-reassigned",
   "creadoEn":"2026-11-12T10:00:00.123456","total":24.68,"items":[
    {"id":9007199254740997,"productoId":7,"nombreProducto":null,"cantidad":2,"precioUnitario":12.34}
   ]},
  {"id":9007199254740994,"usuarioId":"fixture-empty-cart","creadoEn":null,"total":0,"items":[]}
]`;
