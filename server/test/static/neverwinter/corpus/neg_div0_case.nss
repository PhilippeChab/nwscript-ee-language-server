// EXPECT: 1599
// A switch label with a division-by-zero expression can no longer be folded
// into a case value, so it must be rejected as a non-constant case parameter.
// 1599 = STRREF_CSCRIPTCOMPILER_ERROR_CASE_PARAMETER_NOT_A_CONSTANT_INTEGER.
void main()
{
    int x = 1;
    switch (x)
    {
        case 1/0: x = 2; break;
        default: break;
    }
}