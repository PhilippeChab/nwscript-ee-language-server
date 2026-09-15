// EXPECT: 617
// Regression test for https://github.com/niv/neverwinter.nim/issues/114
// A user-defined function redeclared with a different return type must be
// rejected at the declaration/definition comparison, not silently merged.
// Merging keeps the declaration's (void) return type at the call site while
// the implementation still pushes its int return value, which unbalanced the
// VM stack (STACK UNDERFLOW) at run-time.

void some_function();

int some_function()
{
    return 10;
}

void main()
{
    some_function();
}