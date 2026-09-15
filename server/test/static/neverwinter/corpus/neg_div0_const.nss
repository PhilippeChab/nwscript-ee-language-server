// EXPECT: 3752
// Regression test for the constant-folding SIGFPE (issue: div-by-zero crash).
// Evaluating `5 / 0` at compile time crashed the compiler with SIGFPE on x86.
// A const initializer can't be folded (result is undefined), so the compiler
// must reject it instead: 3752 = STRREF_CSCRIPTCOMPILER_ERROR_INVALID_VALUE_ASSIGNED_TO_CONSTANT.
const int X = 5 / 0;

void main()
{
}