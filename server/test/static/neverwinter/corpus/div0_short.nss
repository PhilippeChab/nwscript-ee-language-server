// Division by zero must not crash the compiler, even when it can't be
// constant-folded: it just becomes a runtime operation. In both expressions
// below the right-hand side is never evaluated at runtime (short-circuiting),
// so the script runs fine.
void main()
{
    int r = 1 || (5 / 0);
    Assert(r == 1);
    int s = 0 && (5 / 0);
    Assert(s == 0);
}