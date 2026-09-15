// Regression test for https://github.com/niv/neverwinter.nim/issues/96
// A `for` statement with a null (`;`) body must compile and execute exactly
// like an empty `{}` body. Bioware's own OC scripts use this pattern, e.g.
// nw_pw_peasant9.nss: `for (nCount = 1; GetIsObjectValid(...); nCount++);` --
// historically the compiler rejected it with STRREF 9083.
void main()
{
    int nCount;

    // Exact shape from the issue: the loop only advances via the header.
    for (nCount = 1; nCount < 5; nCount++);
    Assert(nCount == 5);

    // A following statement must not be swallowed by the null body.
    for (nCount = 0; nCount < 3; nCount++);
    Assert(nCount == 3);

    // Omitted init, null body.
    nCount = 0;
    for (; nCount < 4; nCount++);
    Assert(nCount == 4);

    // Countdown with a null body.
    for (nCount = 5; nCount > 0; nCount--);
    Assert(nCount == 0);
}