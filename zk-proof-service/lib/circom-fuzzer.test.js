'use strict';

const { extractDeclaredSignals, extractConstrainedSignals } = require('./circom-fuzzer');

describe('circom-fuzzer static signal analysis', () => {
  it('flags a declared signal that never appears in a constraint', () => {
    const source = `
      template Vulnerable() {
        signal input a;
        signal input b;
        signal output c;
        signal unused;

        c <== a * b;
      }
    `;
    const declared = extractDeclaredSignals(source);
    const constrained = extractConstrainedSignals(source);
    const underConstrained = declared.filter((sig) => !constrained.has(sig));

    expect(declared).toEqual(expect.arrayContaining(['a', 'b', 'c', 'unused']));
    expect(underConstrained).toEqual(['unused']);
  });

  it('reports no under-constrained signals for a fully-constrained circuit', () => {
    const source = `
      template SafeMultiplier() {
        signal input a;
        signal input b;
        signal output c;

        c <== a * b;
      }
    `;
    const declared = extractDeclaredSignals(source);
    const constrained = extractConstrainedSignals(source);
    const underConstrained = declared.filter((sig) => !constrained.has(sig));

    expect(underConstrained).toEqual([]);
  });
});
