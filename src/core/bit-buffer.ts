/** Append-only bit stream, packed most-significant-bit first into bytes. */
export class BitBuffer {
  private readonly bits: number[] = [];

  get length(): number {
    return this.bits.length;
  }

  put(value: number, bitLength: number): void {
    for (let i = bitLength - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }

  putBit(bit: 0 | 1): void {
    this.bits.push(bit);
  }

  /** Pack the stream into bytes, zero-padding the final partial byte. */
  toBytes(): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => {
      if (bit) bytes[i >>> 3]! |= 0x80 >>> (i & 7);
    });
    return bytes;
  }
}
