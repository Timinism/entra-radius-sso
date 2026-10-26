@extends('layouts.librenmsv1')

@section('content')
    <x-device.page :device="$device">
        {!! $data['panel_html'] !!}
    </x-device.page>
@endsection
