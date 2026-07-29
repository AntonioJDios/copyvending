/**
 * Version of the terms of sale the customer accepts at checkout.
 *
 * Bump it whenever the terms change in a way that affects the deal (prices model,
 * delivery, withdrawal rights…). It is stored with each order, so months later you
 * can tell exactly which text that customer agreed to — which is the whole point
 * of asking them to accept it.
 */
export const TERMS_VERSION = '1.0';
