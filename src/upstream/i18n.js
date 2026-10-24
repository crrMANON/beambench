/*!
 * BeamBench Copyright (C) 2025 VisuPhy
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// i18n.js — Chinese labels for the interactive GUI.
// The dictionary is applied to lil-gui labels/buttons at runtime, including
// folders that are rebuilt when a different element is selected.
export const ZH_LABELS = {
  Controls: '控制',
  'Drag onto workspace': '拖拽器件到光具台',
  'Gaussian Beam': '高斯光束',
  'Rays Beam': '光线束',
  'Thin Lens': '薄透镜',
  'Thick Lens': '厚透镜',
  Mirror: '反射镜',
  Polarizer: '偏振片',
  Waveplate: '波片',
  Faraday: '法拉第旋光器',
  'PBS / BS': '偏振分束器 / 分束器',
  'Beam Block': '光束阻挡器',
  Perspective: '透视',
  Bench: '全景',
  Top: '俯视',
  Front: '前视',
  Side: '侧视',
  'Save State': '保存场景',
  'Load State': '载入场景',
  Visualization: '显示设置',
  Lighting: '光照',
  'Ambient Light': '环境光',
  'Key Light': '主光',
  'Fill Light': '补光',
  'Max Interactions': '最大传播次数',
  'Beam Width Scale': '光束宽度缩放',
  'Show Polarization': '显示偏振',
  'Show Table': '显示光具台',
  'Show Labels': '显示标签',
  'Show Contours': '显示轮廓',
  'Training View': '训练视图',
  'Label Font Size': '标签字号',
  'Transform Gizmo': '视图与变换',
  'Reset Camera': '重置相机',
  'Selected Element': '选中器件',
  Actions: '操作',
  Duplicate: '复制',
  Delete: '删除',
  'Center to Beam': '居中到光束',
  'Output Beam Characteristics': '输出光束参数',
  Type: '类型',
  Selected: '当前选中',
  Label: '名称',
  'Incidence (deg)': '入射角 (°)',
  'f (mm)': '焦距 f (mm)',
  'R1 (mm)': 'R1 (mm)',
  'R2 (mm)': 'R2 (mm)',
  'Index n': '折射率 n',
  'Thickness (mm)': '厚度 (mm)',
  'Flat (R = ∞)': '平面 (R = ∞)',
  'Radius R (mm)': '曲率半径 R (mm)',
  Reflectance: '反射率',
  Dichroic: '二向色',
  'Dichroic Bands (nm)': '二向色波段 (nm)',
  'Reflect min': '反射下限',
  'Reflect max': '反射上限',
  'Transmit min': '透射下限',
  'Transmit max': '透射上限',
  'Axis angle (deg)': '轴角 (°)',
  'Fast-axis (deg)': '快轴角 (°)',
  'Retardance Δ (deg)': '相位延迟 Δ (°)',
  'Rotation (deg)': '旋光角 (°)',
  'Reflectance R': '反射率 R',
  'Polarizing (PBS)': '偏振分束 (PBS)',
  'PBS transmits': 'PBS 透射方向',
  'Spacing d (µm)': '栅距 d (µm)',
  'Lines/mm': '线/mm',
  '± Orders': '衍射级次',
  'Orders (Show, θ, Dispersion)': '衍射级次（显示/角度/色散）',
  'Beam Model': '光束模型',
  'Waist w0 (um)': '束腰 w0 (µm)',
  'Rayleigh zR (mm)': '瑞利长度 zR (mm)',
  'Beam Quality M2': '光束质量 M²',
  'Intensity (x)': '强度 (×)',
  'Wavelength (nm)': '波长 (nm)',
  'Bandwidth (nm)': '带宽 (nm)',
  'Spectral Samples': '光谱采样数',
  'Forward Path (cm)': '前向传播 (cm)',
  'Backward Path (cm)': '后向传播 (cm)',
  'Aperture Radius (mm)': '孔径半径 (mm)',
  'Ray Spacing (um)': '光线间距 (µm)',
  'Ray Radius (um)': '光线半径 (µm)',
  'Derived Rays': '派生光线数',
  'Pol Preset': '偏振预设',
  'Psi (deg)': 'ψ (°)',
  'Chi (deg)': 'χ (°)',
  'Translate': '平移',
  'Rotate': '旋转',
  'Resize': '缩放',
  'Yaw (deg)': '偏航 (°)',
  'Tilt (deg)': '俯仰 (°)',
  'Width (mm)': '宽度 (mm)',
  'Height (mm)': '高度 (mm)',
};

export function translateLabel(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  return ZH_LABELS[trimmed] ?? text;
}

/**
 * Translate lil-gui folder titles, control names and buttons in-place.
 * Safe to call repeatedly; unknown labels are left untouched.
 */
export function localizeGui(root = document) {
  if (!root?.querySelectorAll) return;
  const selector = '.lil-gui .title, .lil-gui .name, .lil-gui button';
  root.querySelectorAll(selector).forEach((node) => {
    const current = node.textContent;
    const translated = translateLabel(current);
    if (translated !== current) node.textContent = translated;
  });
}
