function bubblesort(array) {
  const n = array.length;
  for (let i = 0; i < n - 1; i++) {
    // 外層循環控制比較的次數
    for (let j = 0; j < n - i - 1; j++) {
      // 內層循環進行相鄰元素的比較
      if (array[j] > array[j + 1]) {
        // 比較相鄰的兩個數字
        // 如果前一個數字大於後一個數字，則交換它們的位置
        const temp = array[j]; // 暫存前一個數字
        array[j] = array[j + 1]; // 將後一個數字放到前一個數字的位置
        array[j + 1] = temp; // 將暫存的前一個數字放到後一個數字的位置
      }
    }
  }
}
// Example usage
const arr = [64, 34, 25, 12, 22];
bubblesort(arr);
// 輸出排序後的陣列
console.log(arr); // Output: [12, 22, 25, 34, 64]
