// EXPECT: 618

// Regression test for https://github.com/niv/neverwinter.nim/issues/122
// A type mismatch on assignment inside an entry-point-less script used to go
// unreported: the file was parsed, then skipped with "no main" before the
// semantic pass ran. Semantic errors in include-style scripts must be caught.
int this_function_returns_an_int()
{
    return TRUE;
}

void test_function()
{
    string test_string = this_function_returns_an_int();
}
