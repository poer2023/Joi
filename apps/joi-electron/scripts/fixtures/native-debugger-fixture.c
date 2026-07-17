int twice(int value) {
  int result = value * 2;
  return result;
}

int main(void) {
  return twice(21) == 42 ? 0 : 1;
}
