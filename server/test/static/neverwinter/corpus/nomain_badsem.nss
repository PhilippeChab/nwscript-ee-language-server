// EXPECT: 587

// Include-file style script with a semantic error (bad argument type). Even
// when no entry point is required (or when compilation rejects the script for
// lacking one), the semantic pass must still run and flag the error instead of
// silently validating.
void foo(int x)
{
}

void bar()
{
    foo("a");
}