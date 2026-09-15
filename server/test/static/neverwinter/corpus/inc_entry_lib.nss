// Include file for cond_include_main.nss. Must NOT be compiled as a standalone
// script (the test runner skips files starting with "inc_"), so it is only ever
// pulled in via #include.
//
// This file deliberately defines a void main(): if the compiler hijacked the
// entry point from an include, compiling cond_include_main would silently run
// this function instead of the top-level int StartingConditional() (issue #150).

string FROM_INCLUDE_STRING = "value from include";

void main()
{
    Assert(FALSE, "BUG: include's void main was compiled as the entry point");
}