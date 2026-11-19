import { ClpPipe } from './clp.pipe';

describe('ClpPipe', () => {
  const pipe = new ClpPipe();

  it('shows CLP whole pesos and preserves fractions already recorded in history', () => {
    expect(pipe.transform(12990).replace(/\s/g, ' ')).toBe('CLP 12.990');
    expect(pipe.transform(12.99).replace(/\s/g, ' ')).toBe('CLP 12,99');
    expect(pipe.transform(null)).toBe('—');
  });
});
