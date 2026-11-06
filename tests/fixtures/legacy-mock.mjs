// MOCK legacy rows for importer tests. NOT real data: no real titles, people, prices or customers.
// Legacy ids start at 900001 so they can never collide with a real import; e-mails use the reserved .invalid TLD.
export const MOCK_BASE = 900000

export const legacyMock = () => ({
  site_infos: [{ id: 1, name: 'موقع تجريبي', email: 'info@example.invalid', percentage: '٢٠', period_freeze_profit: '14', less_amount_withdraw: '50.5', payment_mode: 'live', show_poster_pc: 1, show_poster_mob: 0 }],
  categories: [
    { id: 900001, name: 'قسم محاكاة 1', status: 1, file: 'category/x.webp', deleted_at: null },
    { id: 900002, name: 'قسم محاكاة 2', status: 0, file: null, deleted_at: '2024-01-02 03:04:05' },
    { id: 900003, name: '   ', status: 1, file: null, deleted_at: null },
  ],
  makers: [
    { id: 900001, name: 'مؤلف محاكاة', type: 'author', status: 1, age: 'old', bio: '<p>نبذة</p><script>alert(1)</script><img src="http://old.invalid/public/uploads/editor/abc.png">', deleted_at: null },
    { id: 900002, name: 'غير معروف النوع', type: 'translator', status: 1, age: 'new', bio: null, deleted_at: null },
  ],
  books: [
    { id: 900001, name: 'كتاب محاكاة مدفوع', type: 'paid', cost: '١٢٫٥٠', currency: 'USD', status: 1, pages: 10, about: '<p onclick="x()">وصف</p>', category: '["900001"]', tags: '["a","b"]', author_id: 900001, reader_id: null, writer_id: null, user_id: null, deleted_at: null, created_at: '2023-01-01 00:00:00' },
    { id: 900002, name: 'كتاب محاكاة مجاني', type: 'free', cost: null, currency: 'USD', status: 2, pages: 0, about: null, category: 'not-json', tags: null, author_id: 900001, deleted_at: null },
    { id: 900003, name: 'كتاب سعر تالف', type: 'paid', cost: 'abc', currency: 'USD', status: 1, deleted_at: null },
    { id: 900004, name: 'كتاب مدفوع بلا سعر', type: 'paid', cost: null, currency: 'USD', status: 1, deleted_at: null },
    { id: 900005, name: 'كتاب حالة غريبة', type: 'paid', cost: '5', currency: 'USD', status: 7, deleted_at: null },
    { id: 900006, name: 'كتاب محذوف', type: 'paid', cost: '1,234.567', currency: 'USD', status: 1, category: '["900001","999999"]', deleted_at: '2024-05-05 00:00:00' },
  ],
  book_media: [
    { id: 900001, book_id: 900001, is_free: 1, name: 'ملف', order: '1', type: 'file', extension: 'pdf', page_count: '10', file: 'product_media/missing-from-archive-0000000001.pdf', external: 0, download: 3 },
    { id: 900002, book_id: 900001, is_free: 2, name: 'رابط خارجي', type: 'file', extension: 'pdf', page_count: '1', file: 'https://example.invalid/x.pdf', external: 1 },
    { id: 900003, book_id: 900001, is_free: 0, name: 'x', type: 'file', file: null, external: 0 },
  ],
  related_books: [{ book_id: 900001, related_id: 900002 }, { book_id: 900002, related_id: 900001 }, { book_id: 900001, related_id: 424242 }],
  articles: [
    { id: 900001, article_type: 'article', guard: 'admin', title: 'مقال محاكاة', pref: 'م', content: '<p>م</p>', status: 1, deleted_at: null },
    { id: 900002, article_type: 'article', guard: 'user', title: 'مقال مستخدم', content: 'x', status: 1 },
  ],
  pages: [
    { id: 900001, url: 'terms-mock', title: 'شروط', content: '<p>x</p>', position: '["footer"]', status: 1, deleted_at: null },
    { id: 900002, url: 'terms-mock', title: 'شروط قديمة', content: '<p>y</p>', position: '["header","bogus"]', status: 1, deleted_at: null },
    { id: 900003, url: 'bad slug', title: 'x', status: 1 },
  ],
  users: [
    { id: 900001, status: 1, type: 0, name: 'عميل محاكاة', email: 'Buyer1@Example.INVALID', password: '$2y$10$MOCKHASHMOCKHASHMOCKHASH', default_password: 'plain-mock-pass', email_verified_at: '2023-01-01 00:00:00', balance: '0', created_by: null },
    { id: 900002, status: 1, type: 2, name: 'مسوق محاكاة', email: 'aff1@example.invalid', password: 'x', balance: '3.30000000000000004', created_by: 'owner' },
    { id: 900003, status: 0, type: 0, name: 'بلا بريد', email: null },
    { id: 900004, status: 9, type: 0, name: 'حالة غريبة', email: 'odd@example.invalid' },
  ],
  orders: [
    { id: 900001, user_id: 900001, affiliate_id: 900002, amount: '12.50', currency: 'USD', status: 1, mode: 'live', invoice_id: 'MOCK-1', response: '{"id":"mock","card":{"number":"4111"},"token":"zzz","ok":true}', created_at: '2023-02-01 10:00:00' },
    { id: 900002, user_id: 900001, amount: '٧٫٠٠', currency: 'USD', status: 1, mode: 'test', created_at: '2023-02-02 10:00:00' },
    { id: 900003, user_id: null, amount: '1,000.10', currency: 'USD', status: 1, mode: 'live' },
    { id: 900004, user_id: 900001, amount: 'free', currency: 'USD', status: 1, mode: 'live' },
  ],
  order_contents: [
    { id: 900001, order_id: 900001, book_id: 900001, cost: '12.50', selling_fee: '0.9', cart_fee: '0.27', net_total: '10.9' },
    { id: 900002, order_id: 900002, book_id: 900001, cost: '7.00' },
    { id: 900003, order_id: 900003, book_id: 123456789, cost: '1000.10' },
  ],
  affiliate_orders: [{ id: 900001, order_id: 900001, affiliate_id: 900002, amount: '12.50', percentage: '10', profit: '1.25', currency: 'USD', available_at: '2023-03-03 00:00:00', status: 1 }],
  withdraws: [{ id: 900001, affiliate_id: 900002, amount: '1.00', currency: 'USD', status: 2, created_at: '2023-04-01 00:00:00' }, { id: 900002, affiliate_id: 900002, amount: '-5', currency: 'USD', status: 1 }],
})
