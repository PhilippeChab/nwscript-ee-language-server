// EXPECT: 617
// Same declaration/implementation return-type mismatch as neg_funcimpl_ret.nss,
// with the call's result consumed by an expression. Previously this failed only
// indirectly at the call site (587, DECLARATION DOES NOT MATCH PARAMETERS);
// it must now be caught at the definition with 617.

void some_function();

int some_function()
{
    return 10;
}

void main()
{
    IntToString(some_function());
}