class_name LoadingScreen
extends CanvasLayer
## Full-screen loading view shown while the battlefield is generated.

var _title: Label
var _step: Label
var _bar: ProgressBar


func _init(place_name: String) -> void:
	layer = 100
	var bg := ColorRect.new()
	bg.color = Color(0.07, 0.08, 0.09)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.custom_minimum_size = Vector2(720, 0)
	box.position = Vector2(-360, -60)
	box.add_theme_constant_override("separation", 14)
	bg.add_child(box)
	_title = Label.new()
	_title.text = place_name
	_title.add_theme_font_size_override("font_size", 34)
	box.add_child(_title)
	_step = Label.new()
	_step.add_theme_font_size_override("font_size", 18)
	_step.modulate = Color(0.75, 0.78, 0.8)
	box.add_child(_step)
	_bar = ProgressBar.new()
	_bar.custom_minimum_size = Vector2(720, 10)
	_bar.show_percentage = false
	_bar.max_value = 1.0
	box.add_child(_bar)


func show_step(text: String, progress: float) -> void:
	_step.text = text
	_bar.value = progress
