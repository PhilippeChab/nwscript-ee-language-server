// EXPECT: 622

// Reproducer for https://github.com/niv/neverwinter.nim/issues/123:
// an unknown identifier called as a function inside an if() condition must
// report UNDEFINED IDENTIFIER (622), not NO RIGHT BRACKET ON EXPRESSION.

void main() { if (unknown_identifier()) PrintString("Check the error code!"); }