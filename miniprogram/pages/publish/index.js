/**
 * 发布闲置
 * 七个字段：标题 / 描述 / 价格 / 分类 / 成色 / 校区 / 图片。
 * 图片先 wx.compressImage 压到 quality 30，再读成 base64 dataURL 存进商品（storage 本地保存，不上传服务器）。
 * 校验规则与提示文案照搬 H5 版 validatePublish，错误提示显示在对应字段下方。
 */
const api = require('../../utils/api.js');

// dataURL 太长会撑爆 storage（单键上限 1MB），压缩后一般 100KB 以内，超 400KB 直接劝换一张
const MAX_IMAGE_BASE64_LENGTH = 400 * 1024;

// 读压缩后的临时文件并转成 dataURL；读不出来返回空串，超大时置 tooLarge
function readImageAsDataUrl(path) {
  const result = { dataUrl: '', tooLarge: false };
  let base64 = '';
  try {
    base64 = wx.getFileSystemManager().readFileSync(path, 'base64');
  } catch (err) {
    console.warn('[海大易物] 读取图片失败', err);
    return result;
  }
  if (!base64) return result;
  if (base64.length > MAX_IMAGE_BASE64_LENGTH) {
    result.tooLarge = true;
    return result;
  }
  result.dataUrl = 'data:image/jpeg;base64,' + base64;
  return result;
}

const CATEGORIES = ['教材书籍', '自行车', '生活用品', '数码电子', '其他'];
const CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'];
// 校区列表只维护一份，放在数据层（utils/api.js 的 CAMPUSES），这里直接引用
const CAMPUSES = api.campuses;

// 与 H5 版完全一致的三条规则：标题必填、价格必填且为大于 0 的最多两位小数、分类必选
function validatePublish(values) {
  const errors = { title: '', price: '', category: '' };
  if (!values.title) {
    errors.title = '请填写标题';
  }
  if (!values.price) {
    errors.price = '请填写价格';
  } else if (!/^\d+(\.\d{1,2})?$/.test(values.price) || Number(values.price) <= 0) {
    errors.price = '价格必须是大于 0 的数字，最多两位小数';
  } else if (Number(values.price) > 99999) {
    errors.price = '价格请填写 99999 以内的金额';
  }
  if (!values.category) {
    errors.category = '请选择分类';
  }
  return errors;
}

Page({
  data: {
    title: '',
    desc: '',
    price: '',
    categories: CATEGORIES,
    conditions: CONDITIONS,
    campuses: CAMPUSES,
    categoryIndex: -1,
    conditionIndex: 2,
    campusIndex: 0,
    categoryText: '请选择分类',
    conditionText: CONDITIONS[2],
    campusText: CAMPUSES[0],
    imagePath: '',
    coverImage: '',
    errors: { title: '', price: '', category: '' },
    formTip: '发布即表示同意：平台上只做信息与沟通，不提供线上支付。',
    submitting: false
  },

  onLoad() {
    // 校区默认跟着当前用户所在的校区走（与 H5 版一致）
    api.getMe().then((me) => {
      // 未登录时 me 为 null：保持默认校区（第一个），不做任何臆测
      const index = me ? CAMPUSES.indexOf(me.campus) : -1;
      if (index >= 0) {
        this.setData({ campusIndex: index, campusText: CAMPUSES[index] });
      }
    }).catch(function (err) {
      console.warn('[海大易物] 读取当前用户失败', err);
    });
  },

  onTitleInput(event) {
    this.setData({ title: event.detail.value, 'errors.title': '' });
  },

  onDescInput(event) {
    this.setData({ desc: event.detail.value });
  },

  onPriceInput(event) {
    this.setData({ price: event.detail.value, 'errors.price': '' });
  },

  onCategoryChange(event) {
    const index = Number(event.detail.value);
    this.setData({ categoryIndex: index, categoryText: CATEGORIES[index], 'errors.category': '' });
  },

  onConditionChange(event) {
    const index = Number(event.detail.value);
    this.setData({ conditionIndex: index, conditionText: CONDITIONS[index] });
  },

  onCampusChange(event) {
    const index = Number(event.detail.value);
    this.setData({ campusIndex: index, campusText: CAMPUSES[index] });
  },

  // 选图后：先预览，再把压缩后的图读成 dataURL 存进商品（不上传服务器）
  onChooseImage() {
    const that = this;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: function (res) {
        const file = res.tempFiles && res.tempFiles[0];
        if (!file) return;
        that.compressAndSave(file.tempFilePath);
      },
      fail: function (err) {
        if (err && String(err.errMsg || '').indexOf('cancel') !== -1) return;
        wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
      }
    });
  },

  // quality 30 一般能把手机原图压到 100KB 以内，storage 存得下
  compressAndSave(imagePath) {
    const that = this;
    wx.compressImage({
      src: imagePath,
      quality: 30,
      success: function (res) {
        const path = (res && res.tempFilePath) || imagePath;
        const read = readImageAsDataUrl(path);
        if (read.tooLarge) {
          // 放弃保存这一张，连预览也清掉，避免用户以为已经带上图了
          that.setData({ imagePath: '', coverImage: '' });
          wx.showToast({ title: '图片太大，请换一张', icon: 'none' });
          return;
        }
        if (!read.dataUrl) {
          // 降级：保留预览，但不保存到商品，发布时用默认封面
          that.setData({ imagePath: path, coverImage: '' });
          wx.showToast({ title: '图片保存失败，将以默认封面发布', icon: 'none' });
          return;
        }
        that.setData({ imagePath: path, coverImage: read.dataUrl });
      },
      fail: function (err) {
        console.warn('[海大易物] 图片压缩失败', err);
        that.setData({ imagePath: imagePath, coverImage: '' });
        wx.showToast({ title: '图片保存失败，将以默认封面发布', icon: 'none' });
      }
    });
  },

  onRemoveImage() {
    this.setData({ imagePath: '', coverImage: '' });
  },

  onSubmit() {
    if (this.data.submitting) return;
    const values = {
      title: String(this.data.title || '').trim(),
      desc: String(this.data.desc || '').trim(),
      price: String(this.data.price || '').trim(),
      category: this.data.categoryIndex >= 0 ? CATEGORIES[this.data.categoryIndex] : '',
      condition: CONDITIONS[this.data.conditionIndex],
      campus: CAMPUSES[this.data.campusIndex]
    };

    const errors = validatePublish(values);
    this.setData({ errors: errors });
    if (errors.title || errors.price || errors.category) {
      wx.showToast({ title: '请检查必填项', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    api.addItem({
      title: values.title,
      desc: values.desc,
      price: Number(values.price),
      category: values.category,
      condition: values.condition,
      campus: values.campus,
      coverImage: this.data.coverImage
    }).then((item) => {
      this.resetForm();
      wx.showToast({ title: '发布成功', icon: 'success' });
      wx.navigateTo({ url: '/pages/detail/index?id=' + item.id });
    }).catch((err) => {
      console.warn('[海大易物] 发布失败', err);
      this.setData({ submitting: false });
      wx.showToast({ title: '发布失败，请重试', icon: 'none' });
    });
  },

  resetForm() {
    const campusIndex = this.data.campusIndex;
    this.setData({
      title: '',
      desc: '',
      price: '',
      categoryIndex: -1,
      conditionIndex: 2,
      categoryText: '请选择分类',
      conditionText: CONDITIONS[2],
      campusIndex: campusIndex,
      campusText: CAMPUSES[campusIndex],
      imagePath: '',
      coverImage: '',
      errors: { title: '', price: '', category: '' },
      submitting: false
    });
  }
});
