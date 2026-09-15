// EXPECT: 3752
// INT_MIN / -1 overflows two's-complement arithmetic and traps on x86 (SIGFPE)
// just like division by zero, so it must not be constant-folded either.
const int X = -2147483648 / -1;

void main()
{
}