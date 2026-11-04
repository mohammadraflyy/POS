/// Stock and quantities are fractional: 5,5 KG is a real stock level, not a typo.
/// Everything is kept to [qtyDecimals] places so a long chain of additions and
/// subtractions never drifts into 5.500000000000001.
library;

const qtyDecimals = 3;

const _qtyFactor = 1000;

/// Rounds a quantity to [qtyDecimals] places.
num bulatkanQty(num value) {
  final rounded = (value * _qtyFactor).round() / _qtyFactor;

  return rounded == rounded.truncateToDouble() ? rounded.toInt() : rounded;
}

/// A usable quantity: a finite, non-negative number. Fractions are allowed.
bool isQtyValid(num value) => value.isFinite && value >= 0;
