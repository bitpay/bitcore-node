#include "CppUnitLite/TestHarness.h"
#include "libbitcoind.h"

#include <string>

using namespace Nan;  // NOLINT(build/namespaces)
using namespace v8;  // NOLINT(build/namespaces)

static inline SimpleString StringFrom(const std::string& value)
{
  return SimpleString(value.c_str());
}

TEST( GetInfo, libbitcoind )
{
}

int main()
{
  TestResult tr;
  TestRegistry::runAllTests(tr);
  return 0;
}
