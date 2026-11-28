export const PAGE_LIMIT = 400_000;

/** 只读前 limit 字节；提前结束迭代也会取消剩余响应体。 */
export const readPrefix = async (response, limit) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    const part = chunk.subarray(0, limit - size);
    chunks.push(part);
    size += part.length;
    if (size === limit) break;
  }
  return Buffer.concat(chunks, size);
};
