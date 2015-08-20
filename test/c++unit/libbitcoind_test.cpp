#include "CppUnitLite/TestHarness.h"

#include <string>

static inline SimpleString StringFrom(const std::string& value)
{
  return SimpleString(value.c_str());
}

TEST( Hello, world )
{
  std::string s1("Hello"), s2("Hello"), s3("world");

  CHECK_EQUAL(s1, s2);
  CHECK_EQUAL(s2, s1);

  CHECK(s1 != s3);
}

int main()
{
  TestResult tr;
  TestRegistry::runAllTests(tr);

  return 0;
}
