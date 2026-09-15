// EXPECT: 3752
// Regression test for https://github.com/niv/neverwinter.nim/issues/137
// A unary operator applied to a string constant used to crash the compiler
// with a nullptr deref in CScriptCompiler::ConstantFoldNode: the
// CONSTANT_STRING folding branch unconditionally dereferenced pNode->pRight,
// which is NULL for unary ops (BOOLEAN_NOT / NEGATION / ONES_COMPLEMENT).
// The correct behaviour is to reject the malformed constant initializer
// (3752 = STRREF_CSCRIPTCOMPILER_ERROR_INVALID_VALUE_ASSIGNED_TO_CONSTANT).
const string S = !"foo";

void main()
{
}