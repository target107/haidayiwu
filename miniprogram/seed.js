/**
 * 海大易物 · 种子数据
 * 12 条贴近海大校园真实场景的二手物品，字段与 web/data/seed.js 完全一致。
 * 12 件商品分给 6 个内置演示账号（张三 / 李四 / 王五 / 赵六 / 孙七 / 周八），每人正好 2 件，sellerName 与账号昵称完全一致，
 * 同一人名下尽量是大类相近的闲置，这样任意一个账号登录后「我的 → 我发布的」都能看到 2 件，买家 / 卖家两种身份都能演示：
 *   i_001 高数 + i_004 考研英语   → u_zhangsan（张三，教材书籍）
 *   i_002 自行车 + i_010 头盔     → u_lisi（李四，骑行代步）
 *   i_007 军训服 + i_009 电风扇   → u_wangwu（王五，生活用品）
 *   i_011 考研政治 + i_012 雨伞   → u_zhaoliu（赵六，鱼山校区自用）
 *   i_003 小冰箱 + i_006 折叠桌椅 → u_sunqi（孙七，生活用品）
 *   i_005 显示器 + i_008 鼠标     → u_zhouba（周八，数码电子）
 * 校区取值与 utils/api.js 的 CAMPUSES 一致：西海岸校区拆成「听海苑」「望海苑」两个。
 * createdAt 用「当前时间往前推若干小时」算出来，让列表里的发布时间更像真实信息流；
 * 只在本地 storage 里没有任何物品时由 utils/api.js 写入一次。
 */

const HOUR = 60 * 60 * 1000;
const now = Date.now();

const SEED_ITEMS = [
  {
    id: 'i_001',
    title: '高等数学同济第七版 上下册',
    desc: '上下册齐全，书页干净，只有少量铅笔笔记可以擦掉。期末复习够用，南海苑自提，也能送到教学楼。',
    price: 25,
    category: '教材书籍',
    condition: '轻微使用痕迹',
    campus: '崂山校区·南海苑',
    sellerName: '张三',
    sellerId: 'u_zhangsan',
    coverColor: '#dbeafe',
    createdAt: now - 3 * HOUR,
    status: 'on',
    views: 46
  },
  {
    id: 'i_002',
    title: '捷安特山地车 九成新',
    desc: '自行车骑了半年，链条刚上过油，刹车灵敏，车筐和车锁一起送。东海苑楼下看车，试骑满意再给钱。',
    price: 480,
    category: '自行车',
    condition: '轻微使用痕迹',
    campus: '崂山校区·东海苑',
    sellerName: '李四',
    sellerId: 'u_lisi',
    coverColor: '#fde68a',
    createdAt: now - 7 * HOUR,
    status: 'on',
    views: 128
  },
  {
    id: 'i_003',
    title: '宿舍小冰箱 60L',
    desc: '宿舍用了一年半，制冷正常，声音不大，放饮料水果很够用。搬宿舍不好带走，北海苑自提，需要两个人抬。',
    price: 260,
    category: '生活用品',
    condition: '轻微使用痕迹',
    campus: '崂山校区·北海苑',
    sellerName: '孙七',
    sellerId: 'u_sunqi',
    coverColor: '#c7f0d8',
    createdAt: now - 11 * HOUR,
    status: 'on',
    views: 87
  },
  {
    id: 'i_004',
    title: '考研英语黄皮书全套',
    desc: '近三年真题加解析，全新未拆封，买重了一套。英语一，南海苑当面交易，考研的同学可以来看看。',
    price: 68,
    category: '教材书籍',
    condition: '全新',
    campus: '崂山校区·南海苑',
    sellerName: '张三',
    sellerId: 'u_zhangsan',
    coverColor: '#fbcfe8',
    createdAt: now - 20 * HOUR,
    status: 'on',
    views: 63
  },
  {
    id: 'i_005',
    title: '显示器 AOC 24寸',
    desc: '1080P 24 寸，含电源线和 HDMI 线，屏幕无坏点无亮点，写代码看剧都够用。鱼山校区自提，太重不邮寄。',
    price: 320,
    category: '数码电子',
    condition: '轻微使用痕迹',
    campus: '鱼山校区·学生公寓',
    sellerName: '周八',
    sellerId: 'u_zhouba',
    coverColor: '#e0e7ff',
    createdAt: now - 26 * HOUR,
    status: 'on',
    views: 154
  },
  {
    id: 'i_006',
    title: '折叠桌椅',
    desc: '桌子加椅子一套，折叠后不占地方，适合租房或者宿舍加张学习桌。桌面有轻微划痕，不影响使用。',
    price: 60,
    category: '生活用品',
    condition: '明显使用痕迹',
    campus: '浮山校区',
    sellerName: '孙七',
    sellerId: 'u_sunqi',
    coverColor: '#fed7aa',
    createdAt: now - 30 * HOUR,
    status: 'on',
    views: 39
  },
  {
    id: 'i_007',
    title: '军训服（全新未拆）',
    desc: '军训前多买了一套，170 到 175 的身高都能穿，吊牌还在。南海苑自提，军训季临时缺衣服的同学可以救急。',
    price: 40,
    category: '生活用品',
    condition: '全新',
    campus: '崂山校区·南海苑',
    sellerName: '王五',
    sellerId: 'u_wangwu',
    coverColor: '#bfdbfe',
    createdAt: now - 34 * HOUR,
    status: 'on',
    views: 21
  },
  {
    id: 'i_008',
    title: '罗技无线鼠标',
    desc: '罗技 M170 无线鼠标，用了一个学期，按键和滚轮都正常，送一节新电池。北海苑当面交易。',
    price: 45,
    category: '数码电子',
    condition: '几乎全新',
    campus: '崂山校区·北海苑',
    sellerName: '周八',
    sellerId: 'u_zhouba',
    coverColor: '#d9f99d',
    createdAt: now - 40 * HOUR,
    status: 'on',
    views: 52
  },
  {
    id: 'i_009',
    title: '电风扇',
    desc: '宿舍落地扇，三档风速，风力足，声音在可接受范围。夏天过完用不上了，南海苑自提，价格可以小刀。',
    price: 35,
    category: '生活用品',
    condition: '轻微使用痕迹',
    campus: '崂山校区·南海苑',
    sellerName: '王五',
    sellerId: 'u_wangwu',
    coverColor: '#fecaca',
    createdAt: now - 46 * HOUR,
    status: 'on',
    views: 18
  },
  {
    id: 'i_010',
    title: '自行车头盔',
    desc: '骑车通勤买的头盔，只戴过几次，内衬可以拆下来洗。听海苑楼下自提，通勤骑车的同学别省这笔钱。',
    price: 25,
    category: '其他',
    condition: '几乎全新',
    campus: '西海岸校区·听海苑',
    sellerName: '李四',
    sellerId: 'u_lisi',
    coverColor: '#a7f3d0',
    createdAt: now - 52 * HOUR,
    status: 'on',
    views: 33
  },
  {
    id: 'i_011',
    title: '考研政治肖四肖八',
    desc: '肖四肖八加背诵手册，有几页划了重点，其余很干净。鱼山校区自提，也可以约在教学楼门口。',
    price: 30,
    category: '教材书籍',
    condition: '轻微使用痕迹',
    campus: '鱼山校区·学生公寓',
    sellerName: '赵六',
    sellerId: 'u_zhaoliu',
    coverColor: '#ddd6fe',
    createdAt: now - 58 * HOUR,
    status: 'on',
    views: 71
  },
  {
    id: 'i_012',
    title: '雨伞+雨衣',
    desc: '海大雨水多，一把结实的折叠伞加一件一次性雨衣，伞骨完好没漏过。雨衣全新没拆，北海苑自提。',
    price: 20,
    category: '其他',
    condition: '全新',
    campus: '崂山校区·北海苑',
    sellerName: '赵六',
    sellerId: 'u_zhaoliu',
    coverColor: '#fef08a',
    createdAt: now - 64 * HOUR,
    status: 'on',
    views: 12
  }
];

module.exports = SEED_ITEMS;
