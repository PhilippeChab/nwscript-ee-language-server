// EXPECT: 3752
// Constant modulo by zero: same SIGFPE family as division by zero, same fix.
const int X = 5 % 0;

void main()
{
}