export const mapConcurrent = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) => {
  const results = new Array<R>(items.length);
  let index = 0;

  const worker = async () => {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
};
