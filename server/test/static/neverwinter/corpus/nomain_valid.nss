// EXPECT: 623

// Include-file style script: valid code but no entry point (void main or
// int StartingConditional). Plain compilation reports it as "no main";
// with SetRequireEntryPoint(FALSE) it validates successfully and produces
// no output code.
void helper(int x)
{
}