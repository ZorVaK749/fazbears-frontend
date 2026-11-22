const fechaSantiago = new Intl.DateTimeFormat('es-CL', {
  timeZone: 'America/Santiago', hourCycle: 'h23',
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function formatearFechaSantiago(fecha?: string): string {
  if (!fecha) return '—';
  // The legacy orders API sends UTC values without an offset.
  const fechaConZona = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(fecha) ? fecha : `${fecha}Z`;
  const instante = new Date(fechaConZona);
  return Number.isNaN(instante.getTime()) ? '—' : fechaSantiago.format(instante);
}
