// Regression test for issue #150: a top-level int StartingConditional() script
// must not have its entry point hijacked by a void main() in an #include'd file.
//
// The include (inc_entry_lib) defines a void main() which would run (and fail
// an Assert) if it were (wrongly) chosen as the entry point. The compiler must
// pick the top-level int StartingConditional() instead.

#include "inc_entry_lib"

int StartingConditional()
{
    Assert(TRUE, "StartingConditional ran");
    return TRUE;
}